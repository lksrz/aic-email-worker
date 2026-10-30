# Privacy review: chore/observability (2026-10-30)

Reviewers: codex gpt-6-astra (high, read-only) + claude-opus-5-5 (high). Base 50029fb.
Prompts: privacy-focused (can any address/subject/body/header/token/IP/PII reach console, exception message/stack, invocation metadata or exports?).

## Round 1 review (commit 4bf8c25)
### Codex
1. **high — wrangler.toml:21:** Disabling Observability does **not** satisfy the absolute privacy bar: live tail events still expose `mailFrom` and `rcptTo`, including the slug, in [email invocation metadata](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/worker-interface.capnp). Sanitizing console strings and exceptions cannot remove these platform fields. **Fix:** restrict live-tail access and explicitly exclude platform metadata from the guarantee; if that exclusion is unacceptable, move email ingress outside Cloudflare Workers.

2. **high — README.md:18:** `wrangler deploy` alone cannot guarantee the valid observability settings were applied. Installed Wrangler 4.152.0 deploys an existing module Worker before PATCHing its non-versioned settings; PATCH failures are caught and reported merely as a service/environment-tag warning (`node_modules/wrangler/wrangler-dist/cli.js:181413`). Previously enabled logging can therefore remain active and capture envelope PII despite deployment success. **Fix:** disable and verify observability before admitting email traffic, then read back all logging/tracing/Issues settings after deployment and fail deployment verification on any mismatch.

### Claude
1. **Medium** at `wrangler.toml:1-8` (top level; nothing in the observability block covers it). **What can leak:** Workers Trace Events Logpush is never set. In Wrangler 4.152.0 `logpush` defaults to `undefined` (`wrangler-dist/cli.js:27243`), and the upload code only sends it when it is defined: `...logpush !== void 0 && { logpush }` at `cli.js:169445`. So if Logpush was ever switched on for this script (dashboard or API), it stays on after `wrangler deploy`, and the observability block can't stop it. Logpush exports the event info, which for email means `mailFrom`, `rcptTo` and `rawSize`, along with console logs and exceptions. That bypasses `[observability] enabled = false`, so the block does not on its own keep everything off. **Fix:** add `logpush = false` at the top level of `wrangler.toml`, then say in the README "Logging & privacy" section that it is also deliberately off.

2. **Low** at `wrangler.toml:1-8`. **What can leak:** `tail_consumers` and `streaming_tail_consumers` default to `undefined` (`cli.js:27001-27019`). The upload code only adds them when they are truthy (`cli.js:169447-169448`), so deploy sends nothing for them. If a tail consumer was attached to this Worker outside this config, it would receive every email event, including the envelope, console output and exceptions, and this config would neither show nor remove it. **Fix:** set `tail_consumers = []` and `streaming_tail_consumers = []` explicitly. An empty array is truthy, so Wrangler does send it. After deploying, check the dashboard to confirm no tail consumer or Logpush job is attached.

The rest checked out:
- **Q1:** Nothing derived from the email reaches the console. The code only logs fixed labels, a closed-set error kind and HTTP status codes, and it never reads `err.message` or `err.name`. postal-mime 2.7.3 contains no `console` calls.
- **Q2:** Nothing leaves `email()` unsanitised. Every await is inside `handleEmail`, postal-mime awaits all of its own promises, and the boundary rethrows a fresh `new Error("email_worker_failed")` with no `cause`.
- **Q3:** The block itself is right. All keys are valid in the 4.152.0 schema (`config-schema.json:4286-4385`), including `issues`, `traces` and `redact_query_string`, and the upload code passes it through as written. The only gaps are items 1 and 2.
- **Q4:** I found no functional regression. URL, `x-agent-token` header and payload are unchanged, and drop, accept and fail behave as before. One small change: a KV value of JSON `null` used to throw and fail the invocation; it is now dropped as `no_gateway_secret`, which matches the stated rule.

## Verify 1 (fix commit 3b9134e: logpush=false, tail_consumers=[], streaming_tail_consumers=[], README read-back + residual live-tail note)
### Codex
1. **RESOLVED** — `logpush = false` is documented; Wrangler 4.152.0 validates it as a boolean and preserves explicit `false` in upload metadata and the settings PATCH.
2. **RESOLVED** — Both tail settings are explicitly `[]`; Wrangler accepts empty arrays and includes them in upload metadata because JavaScript arrays are truthy, with `tail_consumers` also sent in the PATCH.
3. **RESOLVED** — README explicitly identifies live-tail `mailFrom`/`rcptTo` exposure as a residual platform limitation that code cannot remove.
4. **RESOLVED** — README mandates read-back after every deploy and treats mismatches as failure, addressing Wrangler’s caught settings-PATCH failure that only emits a warning.

NO NEW ISSUES.

### Claude
## Verification of the four privacy fixes

| # | Verdict | Evidence |
|---|---|---|
| 1. `logpush` | **RESOLVED** | Wrangler checks `logpush` with `isBoolean`. Because `false` is not `undefined`, it goes into the upload metadata (`cli.js:169445`, `...logpush !== void 0 && { logpush }`) and into the settings PATCH after deploy (`cli.js:181414-181416`, `logpush: worker.logpush`). The README now says to keep Logpush off. |
| 2. tail consumers | **PARTIAL** | `tail_consumers = []` passes validation (`cli.js:29015`, an empty array is valid) and is sent in both the metadata and the post-deploy PATCH (`cli.js:181415`). `streaming_tail_consumers = []` is a different story. This Worker already exists, uses modules and has no DOs or migrations, so `wrangler deploy` uses the versions-API path (`cli.js:181322`). On that path the `script-settings` PATCH sends only `tail_consumers`, `logpush`, `observability` and `tags`. `streaming_tail_consumers` reaches only the version-upload metadata (`cli.js:169448`). Only `wrangler versions deploy` PATCHes it (`maybePatchSettings`, `cli.js:360274`). So nothing shows that a plain `wrangler deploy` clears a streaming tail consumer added outside `wrangler.toml`. |
| 3. Live tail residual | **RESOLVED** | The README now says plainly that live tail (`wrangler tail` or dashboard) shows `mailFrom`/`rcptTo` to any account member who starts a tail. It describes this as platform-level exposure that code cannot remove. |
| 4. Settings read-back | **PARTIAL** | The README now requires a read-back after every deploy and says a mismatch counts as a failed deploy. This matches `cli.js:181422-181424`, where a PATCH failure is caught and only triggers a warning. But the read-back list leaves out `streaming_tail_consumers`, which is exactly the setting the deploy PATCH never sends (see #2). |

## New regressions / issues introduced by the fix

1. **(low) The read-back tool can't be checked from the repo.** README:21 says to run `cf workers list`, but no `cf` binary exists in `node_modules/.bin` and none is pinned in `devDependencies`. From the repo I couldn't confirm that the tool exists or that its output includes `observability`, `logpush` or `tail_consumers`. The README should name a pinned command or the API endpoint instead: `GET /accounts/{id}/workers/scripts/{name}/script-settings`, which is what Wrangler itself calls at `cli.js:117704`.
2. **(low) `streaming_tail_consumers = []` may give false confidence.** The `wrangler.toml` comment says a deploy "also clears values that were changed outside this file". For streaming tail consumers, the plain `wrangler deploy` path in Wrangler 4.152.0 doesn't back that up. Either add `streaming_tail_consumers` to the README read-back list, or run `wrangler versions deploy` / PATCH `script-settings` explicitly.

Nothing else changed: no code, bindings or other config were touched.

## Verify 2 (targeted doc patch 70b5266)
### Codex
2. RESOLVED — The comment now correctly distinguishes version-upload `streaming_tail_consumers` from PATCHed settings and requires verification instead of claiming clearing.
4. RESOLVED — README includes `streaming_tail_consumers` and an explicit API read-back endpoint, making the unpinned `cf` CLI optional.

NO NEW ISSUES

### Claude
Both items are **RESOLVED**, checked against the Wrangler 4.152.0 bundle.

2. **RESOLVED**: on the versions-API deploy path, the post-upload PATCH (`cli.js:181414`) sends only `tail_consumers`, `logpush`, `observability` and `tags`. `streaming_tail_consumers` goes only in the upload metadata (`cli.js:169448`), which is now exactly what the comment says.
4. **RESOLVED**: the README now lists `streaming_tail_consumers` and names `GET /accounts/{account_id}/workers/scripts/aic-email-worker/script-settings`. Wrangler's own `maybePatchSettings` reads `streaming_tail_consumers` from that endpoint's response (`cli.js:360315`), so the field is there. `cf workers list` is now only an optional extra.

**NEW issues:** one minor wording point, not blocking. The new `wrangler.toml` comment says `wrangler deploy` PATCHes logpush, tail_consumers and observability. That only holds for the versions-API path (`canUseNewVersionsDeploymentsApi`, `cli.js:1813xx`). On the legacy upload path, all four settings go in the upload itself and the PATCH carries only `tags` (`cli.js:181466`). The instruction to verify everything after a deploy still holds either way, so this is cosmetic. The same path-dependent wording was already in the README sentence "applies the script settings … in a separate call after the upload", so it isn't new.

## Outcome
All issues RESOLVED, no new issues. Residual (platform-level, not fixable in code): live tail shows mailFrom/rcptTo to any account member who starts a tail.
