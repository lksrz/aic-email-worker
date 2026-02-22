import PostalMime from 'postal-mime';

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
      const response = await fetch(env.OPENCLAW_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.WEBHOOK_SECRET}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error(`Failed to send webhook: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      console.error('Error forwarding email to webhook:', error);
    }
  }
};
