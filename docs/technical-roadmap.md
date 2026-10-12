# awire Technical Roadmap

Date: 2026-07-05

## Verdict

awire should stay a small Cloudflare Worker relay and grow only along three
pressure points:

1. Safer routing and hosted-secret handling.
2. Multi-channel fan-out.
3. Asynchronous delivery with retries, batching, and dead-letter handling.

Do not rewrite the panel as a SPA. Do not move config to D1. Do not introduce
Durable Objects until there is a concrete strong-consistency or per-channel
coordination problem. Do not start with a GitHub App; make the current webhook
route safe and scalable first.

The mature route is:

```text
V1.1: secure the current relay
  route tokens, encrypted dynamic secrets, hosted-vs-self-host API boundary

V1.2: widen routing
  one repo route to many channels, with backward-compatible KV reads

V2: make delivery asynchronous
  Cloudflare Queues producer/consumer, per-channel delivery jobs, DLQ

V2.1: add coordination only where measured
  per-channel Durable Object delivery governor if provider rate limits require it

V3: hosted product automation
  GitHub App installation flow, account-scoped API tokens, optional billing tiers
```

## Evidence From The Current Codebase

Current runtime:

- `src/index.ts` is one Worker entrypoint for health, GitHub webhooks, the
  GitHub OAuth panel, HTMX fragments, and the JSON management API.
- `src/config.ts` stores account-scoped panel config in KV:
  `account:<id>:channels:index`, `account:<id>:channel:<id>`,
  `account:<id>:repos:index`, and `account:<id>:repo:<full>`.
- `src/dedup.ts` uses a separate `DEDUP_KV` namespace with a 10 minute TTL.
- `src/render/index.ts` keeps renderers pure: GitHub payload to internal
  Feishu-card shape, with Slack and Telegram conversion in `src/delivery.ts`.
- `src/panel/auth.ts` already has GitHub OAuth sessions and maps users to
  `accountId = gh_<github numeric id>`.
- `src/json-api-app.ts` is still global `PANEL_TOKEN` management API. It does
  not accept an account id and does not operate on the OAuth account-scoped
  panel keys.
- `openapi/awire.yaml` is generated from the JSON API and feeds the generated
  `awirectl` CLI.

Current constraints from project docs:

- `CONTRIBUTING.md` explicitly rejects a SPA rewrite, D1/SQL backend, and
  multi-user auth before the V2 design lands.
- `docs/ARCHITECTURE.md` says Queues, multi-channel fan-out, per-repo route
  token, GitHub OAuth multi-user, and new sources/sinks are V2 concerns.
- `docs/pinged-comparison.md` already identifies two high-value ports:
  per-repo route tokens and multi-channel routing.

Current verified baseline:

```text
pnpm typecheck      -> passed
pnpm check:openapi -> passed
pnpm test:config   -> passed
pnpm test:delivery -> passed
```

External platform facts checked against current primary docs:

- Workers KV is eventually consistent and optimized for high-volume,
  low-latency reads, not transactional concurrent writes:
  <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
- Cloudflare documents that concurrent writes to the same KV key can overwrite
  one another, and recommends writing from a single process when contention
  matters:
  <https://developers.cloudflare.com/kv/api/write-key-value-pairs/#concurrent-writes-to-the-same-key>
- Cloudflare Queues provide batching, retries, delays, and dead-letter queues:
  <https://developers.cloudflare.com/queues/>
- Durable Objects are for stateful coordination with strongly consistent
  per-object storage:
  <https://developers.cloudflare.com/durable-objects/>
- GitHub App webhooks provide a single app-level webhook that receives events
  for repositories the app can access:
  <https://docs.github.com/en/webhooks/types-of-webhooks>

## Product Direction

awire is not an audit log and not an incident platform. It is a source-event
relay:

```text
source event -> route -> filter -> render -> deliver
```

Keep that boundary. Product value comes from making this relay easy to trust:

- Setup is simple.
- Delivery failures are visible.
- Provider retries do not spam working channels.
- Secrets are not casually exposed.
- The generated CLI and JSON API remain stable enough for automation.
- Hosted demo and self-hosted deployment are clearly separated.

## Architecture Route

### Keep

Keep these decisions:

- One Worker as the main control plane.
- KV for read-heavy route/channel config.
- Separate `CONFIG_KV` and `DEDUP_KV`.
- HTMX server-rendered panel.
- Generated OpenAPI and generated `awirectl`.
- Pure renderers.
- Provider-specific delivery adapters.
- Structured logs keyed by `X-GitHub-Delivery`.

These are already the smallest working architecture for the product.

### Add Next

#### 1. Per-route webhook tokens

Current panel webhook URL:

```text
/hook/github/<account>
```

Target URL:

```text
/hook/github/<account>/<route_token>
```

KV additions:

```text
account:<id>:route_token:<token> -> <repo full_name>
account:<id>:repo:<full_name>    -> RepoConfig { route_token?: string, ... }
```

Resolution order:

1. If `<route_token>` exists, resolve it inside the account and ignore
   payload-controlled repo names for route selection.
2. If the token is missing or invalid, return 404 or 401 and log
   `route_token_rejected`.
3. Keep `/hook/github/<account>` as a compatibility fallback for existing
   routes until the next release window.

Why this comes first:

- It is an isolated security improvement.
- It does not require Queues, D1, GitHub App, or a new auth model.
- It gives the panel a better default webhook URL before fan-out expands the
  blast radius.

#### 2. Encrypt dynamic secrets stored in KV

Current dynamic secrets in KV:

- Feishu webhook URL.
- Feishu signing secret.
- Slack webhook URL.
- Telegram bot token.
- Optional GitHub repo webhook secret.

Target:

- Add Worker secret `CONFIG_ENCRYPTION_KEY`.
- Encrypt dynamic secret fields before `putChannel` / `putRepo`.
- Decrypt only in delivery and signature verification paths.
- Keep public metadata, ids, names, kinds, timestamps, and event filters
  plaintext for listing.

Implementation shape:

```text
EncryptedField = {
  alg: "AES-GCM",
  kid: "v1",
  iv: string,
  value: string
}
```

Migration:

- Read path accepts plaintext and encrypted fields.
- Write path always stores encrypted fields when `CONFIG_ENCRYPTION_KEY`
  exists.
- Add a one-time `awirectl` or script migration only if bulk conversion is
  needed later.

Why this is worth doing:

- Hosted awire currently asks users to store delivery credentials in the
  hosted Worker's KV.
- Encryption does not change the product model.
- It reduces damage if KV data is exported or leaked.

#### 3. Clarify API scopes before growing hosted usage

Current split:

- OAuth panel: account-scoped KV.
- JSON API / `awirectl`: global `PANEL_TOKEN`, global KV keys.

This is acceptable for self-hosted operator automation. It is not acceptable
as the hosted product API.

Target:

- Keep the current global JSON API as the self-hosted operator API.
- Document that hosted demo users should use the panel only for now.
- Add account-scoped API tokens only when hosted automation is a real product
  requirement.

Account-scoped API token shape when needed:

```text
account:<id>:api_tokens:index       -> string[]
account:<id>:api_token:<token_id>   -> { hash, name, created_at, last_used_at }
```

The JSON API then resolves `accountId` from the token and uses the same
account-scoped config functions as the panel.

#### 4. Multi-channel routing

Current model:

```ts
RepoConfig.channel_id: string
```

Target model:

```ts
RepoConfig.channel_ids: string[]
```

Backward-compatible read:

```text
if channel_ids exists -> use it
else if channel_id exists -> normalize to [channel_id]
```

Fan-out policy before Queues:

- Do not ship broad synchronous fan-out unless the max channel count is tiny.
- If synchronous fan-out is used as a stepping stone, cap it at 3 channels and
  return 200 when at least one delivery succeeds, while logging failures.

Preferred production policy:

- Ship multi-channel together with Queues.
- The webhook handler enqueues one delivery job per target channel.
- The webhook response depends on enqueue success, not provider delivery
  success.
- Provider failures are retried independently and cannot re-spam already
  successful channels.

#### 5. Cloudflare Queues for delivery

Current hot path sends to providers synchronously:

```text
GitHub -> Worker -> provider webhook
```

Target V2 hot path:

```text
GitHub -> Worker -> verify -> route -> filter -> render -> enqueue jobs -> 202/200
Queue consumer -> deliver one job -> ack/retry/DLQ
```

Delivery job:

```ts
type DeliveryJob = {
  job_id: string;
  delivery_id: string;
  account_id?: string;
  repo: string;
  event: string;
  action?: string;
  channel_id: string;
  card: FeishuCard;
  created_at: string;
};
```

Store the rendered card, not the raw GitHub payload. That keeps the queue
focused on delivery and avoids retaining full webhook bodies.

Queue behavior:

- Producer runs after signature verification, route resolution, filtering, and
  rendering.
- Consumer loads the channel config by `account_id` and `channel_id`.
- Consumer calls `deliver(channel, card)`.
- Success acknowledges that message.
- Provider 429/5xx retries that message.
- Permanent config errors can be acknowledged after structured logging, or sent
  to DLQ depending on the failure type.
- Configure a DLQ for messages that exceed retry limits.

Why Queues before Durable Objects:

- Queues solve the immediate reliability problem: retries, backpressure,
  batching, delayed retry, and DLQ.
- Durable Objects solve coordination. awire should not pay that complexity
  until per-channel rate limiting cannot be handled by queue retry policy.

#### 6. Per-channel Durable Object governor only when measured

Add a Durable Object only if real provider behavior shows queue consumers are
still exceeding provider limits, especially Feishu/Lark bot limits.

Object identity:

```text
delivery-governor:<account_id>:<channel_id>
```

Responsibility:

- Serialize sends for one channel.
- Enforce provider-specific pacing.
- Optionally coalesce noisy messages within a short window.

Do not use Durable Objects for general config storage unless account-level
concurrent writes become a real problem.

#### 7. GitHub App later

GitHub App is the right V3 product move, not the next engineering move.

It becomes worth it when awire needs:

- One-click install across many repositories.
- Organization-level onboarding.
- Automatic webhook event subscription.
- Better repository ownership checks.
- Hosted service packaging.

Do not start there. It changes permissions, account mapping, webhook setup,
support burden, and product trust surface at the same time.

## Migration Plan

### Phase 0: Baseline hardening

Goal: make the existing relay safer without changing its architecture.

Work:

- Add route tokens.
- Encrypt dynamic KV secrets.
- Document hosted panel vs self-hosted JSON API.
- Add route-token and encryption self-checks.

Verification:

```text
pnpm typecheck
pnpm check:openapi
pnpm test:config
pnpm test:delivery
pnpm deploy:dry
```

Release criteria:

- Existing `/hook/github/<account>` routes still work.
- New panel-created routes show tokenized URLs.
- Tokenized route rejects invalid tokens before delivery.
- No plaintext dynamic secrets are written after encryption is enabled.

### Phase 1: Multi-channel route model

Goal: one route can target multiple channels.

Work:

- Add `channel_ids` normalization.
- Update panel channel selector.
- Update JSON API schema and regenerate OpenAPI.
- Regenerate `awirectl`.
- Keep old `channel_id` reads.

Verification:

```text
pnpm typecheck
pnpm check:openapi
pnpm test:config
pnpm test:delivery
cd cli && go test ./...
cd cli && go build -o /tmp/awirectl-roadmap-check ./cmd/awirectl
```

Release criteria:

- Existing single-channel routes still load.
- New routes can select more than one channel.
- API output is unambiguous.
- CLI can create and update multi-channel routes.

### Phase 2: Queue-backed delivery

Goal: decouple GitHub webhook success from provider availability.

Work:

- Add a queue binding.
- Add a producer after rendering.
- Add a consumer that calls `deliver`.
- Add DLQ config.
- Add structured logs for enqueue, consumer success, retryable failure,
  permanent failure, and DLQ handoff.

Verification:

```text
pnpm typecheck
pnpm check:openapi
pnpm test:config
pnpm test:delivery
pnpm deploy:dry
```

Add one local queue self-check or script that proves:

- A webhook-like job can be encoded.
- A consumer can deliver it with mocked `fetch`.
- Retryable failure does not acknowledge success.
- Permanent missing-channel failure does not loop forever.

Release criteria:

- GitHub receives success once enqueue succeeds.
- Provider outage does not block webhook response.
- Failed channel does not cause duplicate sends to successful channels.
- DLQ receives exhausted failures.

### Phase 3: Rate-limit governor, only if needed

Goal: handle real provider rate limits without turning the whole system into a
stateful framework.

Trigger:

- Worker logs or provider responses show repeated 429s for the same channel
  after queue retry tuning.

Work:

- Add a Durable Object per account/channel.
- Queue consumer sends jobs to the governor for that channel.
- Governor serializes and paces provider calls.

Release criteria:

- 429 rate falls in production logs.
- Delivery latency remains acceptable.
- Governor failure mode is visible and retryable.

### Phase 4: GitHub App product mode

Goal: remove manual webhook setup for hosted users.

Trigger:

- Hosted users are the main audience, not self-hosted operators.
- Account-scoped API tokens and route tokens already exist.
- Delivery reliability is already queue-backed.

Work:

- GitHub App registration.
- Installation callback handling.
- Installation-to-account mapping.
- Repository selection UI.
- Webhook event subscription management.

Release criteria:

- Manual webhook mode still works.
- GitHub App install can onboard a repo without manual webhook setup.
- Permission model is documented and minimal.

## What Not To Build Now

Do not build:

- D1 config backend.
- React/Vite SPA panel.
- Event payload persistence or audit log.
- Generic source/sink plugin framework.
- Workflow engine.
- GitHub App before route tokens, encryption, multi-channel routing, and queue
  delivery.
- Durable Objects for every account or route by default.

Add each only when the trigger in this document is met.

## Adversarial Review

### Round 1: "KV is eventually consistent. This roadmap is unsafe."

Attack:

- KV reads are eventually consistent.
- Index updates can lose concurrent writes.
- A hosted product may have multiple browser tabs and API clients editing the
  same account.

Finding:

- The webhook hot path is a read-heavy exact-key lookup. KV is still the right
  default for that.
- Current writes are low-volume operator writes.
- The real risk is not hot-path reads; it is concurrent writes to index keys.

Change to plan:

- Keep KV for config.
- Do not add D1.
- Add a trigger for per-account Durable Object write serialization only if
  account-scoped concurrent edits become a measured problem.
- Keep route/channel list indexes bounded and simple.

Pass condition:

- The plan no longer claims KV is strongly consistent.
- It names the actual failure mode and the smallest future fix.

Result: pass.

### Round 2: "Synchronous multi-channel fan-out will duplicate messages."

Attack:

- If one of three channels fails and the Worker returns 502, GitHub retries the
  whole delivery.
- Already successful channels may receive duplicates.
- Provider rate limits become worse as channel count grows.

Finding:

- Multi-channel is valuable, but synchronous fan-out is the wrong mature
  production shape.
- The unit of retry must be one channel delivery job, not the whole GitHub
  webhook.

Change to plan:

- Multi-channel should ship with queue-backed delivery for production use.
- Webhook success means "jobs accepted", not "all providers accepted".
- Delivery retries happen per channel.

Pass condition:

- A failing channel cannot cause a successful sibling channel to be re-sent by
  GitHub retry.

Result: pass.

### Round 3: "GitHub App should be first because onboarding is the real UX."

Attack:

- Manual webhook setup is the highest-friction user journey.
- Account-wide routes still require GitHub to send events.
- A GitHub App would make the product feel complete.

Finding:

- True for a hosted SaaS product, false for the next safe engineering step.
- GitHub App changes auth, permissions, installation state, event
  subscriptions, support surface, and account ownership all at once.
- Current route URL is not safe enough yet, and delivery is not queue-backed.

Change to plan:

- Keep GitHub App as V3.
- Ship route tokens and queue-backed delivery first.
- Use generated CLI and panel improvements for near-term setup speed.

Pass condition:

- The roadmap improves setup safety now without taking on GitHub App complexity
  before the core relay is reliable.

Result: pass.

### Round 4: "Hosted KV secrets make the demo unfit for serious users."

Attack:

- README says channel credentials and webhook secrets are stored in hosted KV.
- Users may paste real Slack, Telegram, or Feishu credentials.
- A hosted route cannot mature if dynamic secrets stay plaintext in KV.

Finding:

- This is a real product-trust issue.
- Worker secrets cannot hold per-user dynamic credentials.
- App-level envelope encryption is the smallest useful improvement.

Change to plan:

- Add `CONFIG_ENCRYPTION_KEY`.
- Encrypt dynamic secret fields in KV.
- Keep self-hosting as the answer for users who need full infrastructure
  control.

Pass condition:

- KV export no longer reveals dynamic delivery credentials in plaintext after
  encryption is enabled.

Result: pass.

## Success Gates

Every implementation phase must keep these gates green:

```text
pnpm typecheck
pnpm check:openapi
pnpm test:config
pnpm test:delivery
pnpm deploy:dry
```

When JSON API changes:

```text
pnpm gen:openapi
pnpm check:openapi
cd cli && go test ./...
cd cli && go build -o /tmp/awirectl-check ./cmd/awirectl
```

When webhook behavior changes:

```text
pnpm test:webhook
```

When delivery semantics change:

- Mock provider success.
- Mock provider 429.
- Mock provider 5xx.
- Mock missing channel config.
- Verify structured logs include delivery id, account id when present, event,
  action, repo, channel, and failure class.

When UI behavior changes:

- Verify the exact panel flow visually in a browser.
- Check tokenized webhook URL rendering.
- Check route/channel create, update, delete, and test-send.

## Final Recommendation

The next concrete engineering sequence should be:

1. Per-route webhook token.
2. KV dynamic-secret encryption.
3. Hosted-vs-self-hosted API scope clarification.
4. Multi-channel route model.
5. Queue-backed delivery.
6. Per-channel Durable Object governor only if rate-limit evidence demands it.
7. GitHub App hosted onboarding.

This route keeps awire small while moving it toward a production-grade relay.
