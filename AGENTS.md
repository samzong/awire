# AGENTS.md

## Scope

Repo-local instructions for awire. Follow the global agent rules first, then these awire-specific rules.

## Cloudflare Log Analysis

awire uses Cloudflare Workers Logs for production webhook diagnosis. Do not conclude that Cloudflare, GitHub, or Feishu dropped a message until you compare the GitHub delivery record with Worker logs.

Use `X-GitHub-Delivery` as the correlation key. The Worker logs it as `delivery` on webhook paths.

Start with live logs only for active repros:

```bash
rtk pnpm exec wrangler tail awire --format=json --search <delivery-id>
```

For historical incidents, use Cloudflare Workers Logs / Observability Query Builder or the Observability telemetry API. Discover field names with the telemetry keys endpoint before writing API filters; if the custom JSON field is not exposed as a typed key, search the delivery id as text.

Expected webhook log messages:

- `webhook_invalid_json`
- `webhook_received`
- `signature_rejected`
- `dedup_duplicate`
- `route_missing`
- `event_filtered`
- `renderer_dropped`
- `feishu_failed`
- `forwarded`

Interpretation order:

1. If GitHub has no delivery, inspect the repo webhook's subscribed GitHub events first. A route that allows `pull_request.opened` does nothing if the GitHub hook is only subscribed to `push`; awire never received the event.
2. If `webhook_received` is absent but GitHub shows a delivery to this Worker URL, check Cloudflare routing, Worker metrics, and Workers Logs sampling/retention before blaming app code.
3. If `webhook_received` exists, use the terminal log message above to locate the drop point.
4. If `feishu_failed` is followed by `dedup_duplicate` for the same delivery, the dedup mark happened before a successful send.

Never log or paste payload bodies, Feishu webhook URLs, GitHub webhook secrets, panel tokens, or Cloudflare tokens. Use local environment variables or existing Wrangler auth for API access; do not ask the user to paste secrets into chat.
