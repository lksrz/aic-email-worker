import PostalMime from 'postal-mime';

// Privacy: this Worker handles third-party email. Logs are fixed strings only
// (no addresses, slug, URL, response body or error text), and only for drops
// and failures — a successful forward logs nothing.

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function handleEmail(message, env) {
  const rawEmail = await new Response(message.raw).arrayBuffer();
  const parser = new PostalMime();
  const parsedEmail = await parser.parse(rawEmail);

  const recipient = message.to.toLowerCase();
  // Robust slug extraction: find the actual email address part first
  const emailMatch = recipient.match(/([a-z0-9._%+-]+)@[a-z0-9.-]+\.[a-z]{2,}/);
  const targetEmail = emailMatch ? emailMatch[0] : recipient;
  const slug = targetEmail.split('@')[0];

  // Verify agent exists in KV
  const agentRaw = await env.AIC_KV.get(`aic_agent:${slug}`);
  if (!agentRaw) {
    console.error('email dropped: no agent');
    return;
  }

  const agent = JSON.parse(agentRaw);
  if (!agent.gatewaySecret) {
    console.error('email dropped: no gateway secret');
    return;
  }

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

  // Use the custom agents domain if possible, fallback to fly.dev
  const webhookUrl = `https://aic-${slug}.fly.dev/api/webhook/email`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': agent.gatewaySecret
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error(`webhook rejected: ${response.status}`);
    }
  } catch {
    console.error('webhook unreachable');
  }
}

export default {
  async email(message, env, ctx) {
    try {
      await handleEmail(message, env);
    } catch {
      // Still fail the invocation, but without the original message/stack
      // (JSON.parse would quote the KV record, including gatewaySecret).
      throw new Error('email_worker_failed');
    }
  }
};
