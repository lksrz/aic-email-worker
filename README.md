# AI Commander Email Worker

Cloudflare Worker for handling inbound emails via [Email Routing](https://developers.cloudflare.com/email-routing/).

## How it works

1.  Cloudflare receives an email for `<slug>@aicommander.dev` (catch-all rule).
2.  The Email Routing rule triggers this Worker.
3.  The Worker parses the email (including attachments) using `postal-mime`.
4.  The Worker looks up `aic_agent:<slug>` in the `AIC_KV` namespace; unknown slugs and agents without a
    `gatewaySecret` are dropped.
5.  The Worker POSTs a JSON payload to `https://aic-<slug>.fly.dev/api/webhook/email` with the agent's
    `gatewaySecret` in the `x-agent-token` header. A failed or rejected webhook call is logged and the email is
    not retried.

## Setup

1.  **Deploy**: Run `npx wrangler deploy` (Wrangler is pinned in `devDependencies`; run `npm ci` first).
    Wrangler applies the script settings (observability, Logpush, tail consumers) in a separate call after the
    upload and only warns if that call fails, so read the settings back after every deploy and treat any
    mismatch with `wrangler.toml` as a failed deploy: `observability`, `logpush`, `tail_consumers` and
    `streaming_tail_consumers` from the Cloudflare API
    `GET /accounts/{account_id}/workers/scripts/aic-email-worker/script-settings` (or, with the Cloudflare
    `cf` CLI, the Worker's entry in `cf workers list`).
2.  **Enable Routing**:
    *   Go to Cloudflare Dashboard -> Email -> Email Routing.
    *   Add a custom address (e.g., `*@aicommander.dev`).
    *   Select "Send to Worker" and pick `aic-email-worker`.

## Logging & privacy

The Worker handles third-party email, so it logs as little as possible: nothing on a successful forward, and only
fixed strings on a drop or failure (`email dropped: no agent`, `email dropped: no gateway secret`,
`webhook rejected: <HTTP status>`, `webhook unreachable`) — never addresses, slug, subject, body, the KV record,
the webhook URL or its response body.

Any other error is caught at the `email()` boundary and replaced by `new Error("email_worker_failed")`, so the
invocation still fails but no original error message or stack (which can quote the KV value) leaves the handler.

**Workers Observability is kept off** (`wrangler.toml` sets every field explicitly, because `wrangler deploy`
overwrites dashboard settings). Cloudflare enriches every stored event of an `email()` invocation with the email
envelope regardless of what the code logs: the invocation message is the recipient address, and the email event
info carries `mailFrom`/`rcptTo`/`rawSize` (traces record `cloudflare.email.from/to`). `invocation_logs = false`
only drops the per-invocation record, not this enrichment of console/exception events. Turning on
`[observability] enabled` / `[observability.logs] enabled` therefore stores the recipient (and very likely the
sender) address for every logged line. Keep `traces`, `issues`, `logpush` and tail consumers off for the same
reason. Residual, platform-level exposure that code cannot remove: real-time logs (`wrangler tail`, dashboard live
logs) work without Workers Logs and show the envelope (`mailFrom`, `rcptTo`) to any account member who starts a
tail; nothing is stored unless someone is tailing.

## Payload Structure

```json
{
  "timestamp": "ISO-8601",
  "to": "agent@aicommander.dev",
  "from": "user@example.com",
  "subject": "Hello",
  "text": "Body text",
  "html": "<div>...</div>",
  "message_id": "<id@example.com>",
  "attachments": [
    {
      "filename": "report.pdf",
      "mimeType": "application/pdf",
      "data": "base64..."
    }
  ]
}
```
