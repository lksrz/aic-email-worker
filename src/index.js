import PostalMime from 'postal-mime';

// Logging policy (privacy): this Worker handles third-party email. Nothing
// derived from the message (addresses, slug, subject, body, headers, MIME),
// from KV (gatewaySecret) or from the webhook (URL, response body) may ever be
// written to console output or carried by an exception. Logs are fixed JSON
// labels plus values from closed sets (stage, error kind) or an HTTP status
// number. Errors are never logged or rethrown as-is: their message/stack can
// embed input (e.g. JSON.parse quotes the KV value, fetch quotes the URL).

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Closed enum of error kinds; never reads err.name/err.message (both can be
// input-controlled).
function errorKind(err) {
  if (err instanceof TypeError) return 'TypeError';
  if (err instanceof SyntaxError) return 'SyntaxError';
  if (err instanceof RangeError) return 'RangeError';
  if (err instanceof Error) return 'Error';
  return 'NonError';
}

function logEvent(level, event, fields) {
  const line = JSON.stringify({ event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function handleEmail(message, env, state) {
  state.stage = 'read';
  const rawEmail = await new Response(message.raw).arrayBuffer();

  state.stage = 'parse';
  const parser = new PostalMime();
  const parsedEmail = await parser.parse(rawEmail);

  state.stage = 'slug';
  const recipient = message.to.toLowerCase();
  // Robust slug extraction: find the actual email address part first
  const emailMatch = recipient.match(/([a-z0-9._%+-]+)@[a-z0-9.-]+\.[a-z]{2,}/);
  const targetEmail = emailMatch ? emailMatch[0] : recipient;
  const slug = targetEmail.split('@')[0];

  // Verify agent exists in KV
  state.stage = 'lookup';
  const agentRaw = await env.AIC_KV.get(`aic_agent:${slug}`);
  if (!agentRaw) {
    logEvent('error', 'email_dropped', { reason: 'no_agent' });
    return;
  }

  state.stage = 'agent';
  const agent = JSON.parse(agentRaw);
  if (!agent || !agent.gatewaySecret) {
    logEvent('error', 'email_dropped', { reason: 'no_gateway_secret' });
    return;
  }

  state.stage = 'payload';
  const payload = {
    timestamp: new Date().toISOString(),
    to: message.to,
    from: message.from,
    subject: parsedEmail.subject,
    text: parsedEmail.text,
    html: parsedEmail.html,
    message_id: parsedEmail.messageId,
    attachments: (parsedEmail.attachments || []).map(a => ({
      filename: a.filename,
      mimeType: a.mimeType,
      data: arrayBufferToBase64(a.content)
    }))
  };
  const body = JSON.stringify(payload);

  // Use the custom agents domain if possible, fallback to fly.dev
  const webhookUrl = `https://aic-${slug}.fly.dev/api/webhook/email`;

  state.stage = 'forward';
  let response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': agent.gatewaySecret
      },
      body
    });
  } catch (err) {
    // Same delivery semantics as before: a failed webhook call is logged and
    // the email is accepted (not retried).
    logEvent('error', 'webhook_unreachable', { error: errorKind(err) });
    return;
  }

  if (!response.ok) {
    // Status only: the response body may echo the forwarded email.
    logEvent('error', 'webhook_rejected', { status: response.status });
    return;
  }
  logEvent('log', 'email_forwarded', { status: response.status });
}

export default {
  async email(message, env, ctx) {
    const state = { stage: 'start' };
    try {
      await handleEmail(message, env, state);
    } catch (err) {
      logEvent('error', 'email_failed', { stage: state.stage, error: errorKind(err) });
      // Keep the invocation failing (as before) so Email Routing does not treat
      // the message as delivered, but with a fixed message and no cause: the
      // original error's message/stack never leaves this function.
      throw new Error('email_worker_failed');
    }
  }
};
