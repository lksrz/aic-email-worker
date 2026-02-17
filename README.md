# AI Commander Email Worker

Cloudflare Worker for handling inbound emails via [Email Routing](https://developers.cloudflare.com/email-routing/).

## How it works

1.  Cloudflare receives an email for a configured address.
2.  The Email Routing rule triggers this Worker.
3.  The Worker parses the email (including attachments) using `postal-mime`.
4.  The Worker sends a JSON payload to the configured `OPENCLAW_WEBHOOK_URL`.

## Setup

1.  **Deploy**: Run `npx wrangler deploy`.
2.  **Configure URL**: Update `wrangler.toml` or set via Dashboard: `OPENCLAW_WEBHOOK_URL`.
3.  **Set Secret**: Run `npx wrangler secret put WEBHOOK_SECRET`. This token should match the one expected by your OpenClaw webhook skill.
4.  **Enable Routing**:
    *   Go to Cloudflare Dashboard -> Email -> Email Routing.
    *   Add a custom address (e.g., `*@aicommander.dev`).
    *   Select "Send to Worker" and pick `aic-email-worker`.

## Payload Structure

```json
{
  "timestamp": "ISO-8601",
  "to": "agent@aicommander.dev",
  "from": "user@example.com",
  "subject": "Hello",
  "text": "Body text",
  "html": "<div>...</div>",
  "attachments": [
    {
      "filename": "report.pdf",
      "mimeType": "application/pdf",
      "content": "base64..."
    }
  ]
}
```
