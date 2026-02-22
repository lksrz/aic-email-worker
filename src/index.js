import PostalMime from 'postal-mime';
import { Buffer } from 'node:buffer';

function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

export default {
  async email(message, env, ctx) {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsedEmail = await parser.parse(rawEmail);

    const payload = {
      timestamp: new Date().toISOString(),
      to: message.to,
      from: message.from,
      subject: parsedEmail.subject,
      text: parsedEmail.text,
      html: parsedEmail.html,
      attachments: (parsedEmail.attachments || []).map(a => ({
        filename: a.filename,
        mimeType: a.mimeType,
        data: arrayBufferToBase64(a.content)
      }))
    };

    try {
      const payloadString = JSON.stringify(payload);

      // Extract the agent name from the recipient email (e.g., ala1@aicommander.dev -> ala1)
      const recipientMatch = message.to.match(/^([^@]+)@/);
      if (!recipientMatch) {
        throw new Error(`Could not parse username from recipient address: ${message.to}`);
      }
      const agentAlias = recipientMatch[1].toLowerCase();

      // Dynamically construct the specific Fly.io agent container webhook route
      const webhookUrl = `https://aic-${agentAlias}.fly.dev/api/webhook/email`;
      console.log(`Routing email for ${message.to} -> ${webhookUrl} (Payload: ${payloadString.length} bytes)`);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.WEBHOOK_SECRET}`
        },
        body: payloadString
      });

      console.log(`Webhook response status: ${response.status}`);
      if (!response.ok) {
        console.error(`Failed to send webhook: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      console.error('Error forwarding email to webhook:', error.message, error.stack);
    }
  }
};
