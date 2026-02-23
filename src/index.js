import PostalMime from 'postal-mime';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default {
  async email(message, env, ctx) {
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
      console.error(`No agent found for slug: ${slug}. Dropping email.`);
      return;
    }

    const agent = JSON.parse(agentRaw);
    if (!agent.gatewaySecret) {
      console.error(`Agent ${slug} has no gateway secret. Dropping email.`);
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
    console.log(`Forwarding email for ${slug} to ${webhookUrl}`);

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
        console.error(`Failed to send webhook to ${webhookUrl}: ${response.status} ${await response.text()}`);
      } else {
        console.log(`Email successfully forwarded to agent: ${slug}`);
      }
    } catch (error) {
      console.error('Error forwarding email to webhook:', error);
    }
  }
};
