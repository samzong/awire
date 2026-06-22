# Architecture

This document explains how a request flows through awire and why each major
decision was made the way it was. It is the reference for contributors who
need to change something non-trivial.

## The one-paragraph model

awire is a single Cloudflare Worker. GitHub posts a webhook to `/hook/github`;
the worker verifies the signature, deduplicates by delivery id, looks up the
repo's routing config in KV, filters by event, renders a Feishu card, and
posts it to the target channel's webhook. Configuration lives in a KV
namespace; dedup markers live in a second KV namespace. An HTMX panel at a
non-guessable path lets the operator manage channels and repos. There is no
database, no frontend build, no message queue — those are V2.

## Request lifecycle

```
POST /hook/github
  │
  ├─ 1. parse body        raw ArrayBuffer kept for signature verification
  │                          (re-serialized JSON would break HMAC)
  │
  ├─ 2. resolve route     KV.get(`repo:<full_name>`) → RepoConfig | null
  │                          miss → 200 { ignored: "no route" } (silent)
  │
  ├─ 3. verify signature  if repo has webhook_secret:
  │                          crypto.subtle.verify("HMAC", key, sig, rawBody)
  │                          constant-time; 401 on mismatch (no retry)
  │
  ├─ 4. dedup             KV.get(deliveryId) on DEDUP_KV
  │                          hit  → 200 { dedup: true }
  │                          miss → KV.put(deliveryId, "1", TTL 600s)
  │                          done BEFORE send, so retries cannot race
  │
  ├─ 5. filter            shouldForward(events, event, action)?
  │                          "*" | "<event>" | "<event>.<action>"
  │                          miss → 200 { filtered: true }
  │
  ├─ 6. render            renderEvent(event, action, payload) → FeishuCard | null
  │                          specialized template OR generic fallback
  │                          null → 200 { dropped: "renderer" }
  │
  └─ 7. send              POST to channel.webhook_url
                             optional Feishu signing (key = `${ts}\n${secret}`,
                             message = empty string — the #1 footgun)
                             inspect body.StatusCode === 0 for real success
                             failure → 502 (GitHub retries)
```

Steps 3–4 are the security and reliability core. Step 6 is where most
contributions land (new event renderers).

## Why these decisions

### Pure KV, no D1

D1 adds a SQL service, migrations, and a cold-read path. awire's hot path
needs exactly one keyed lookup per webhook (`repo:<full_name>`), which KV
serves in single-digit milliseconds at the edge. The panel's list views use
an index pattern (`repos:index` → `string[]` → fan-out reads), which is
fine for dozens to hundreds of repos.

The honest cost: KV is eventually consistent, so a config change can take
up to ~60s to reach every edge. For a notification relay this is
acceptable. It would not be acceptable for, say, a payments system.

### Two KV namespaces, not one

`CONFIG_KV` (permanent) and `DEDUP_KV` (10-min TTL) are separated because
they have different lifetimes, different write volumes, and different blast
radii. Mixing them would either pin dedup keys to permanent storage or risk
dedup garbage touching config keys. Cloudflare's own guidance is to split
namespaces by data class.

### Atomic dedup before send

The dedup check and the dedup mark happen in one step, *before* the Feishu
send. If they were split (check, send, mark), a GitHub retry landing during
the send window would pass the check and produce a duplicate. The current
code accepts a narrower race: two genuinely concurrent retries with the same
delivery id could both mark and both send. GitHub's retries are serial
(next attempt only after timeout/5xx), so this is not a practical concern.

### Verify against raw bytes, not re-parsed JSON

`JSON.parse(body)` then `JSON.stringify(parsed)` does not produce byte-
identical output to the original body — key ordering and whitespace differ.
GitHub signs the exact bytes it sent. So verification uses the raw
`ArrayBuffer` from `req.arrayBuffer()`, and parsing happens separately.

### Feishu success = HTTP 200 AND `StatusCode: 0`

Feishu's webhook API returns HTTP 200 even on logical failure (rate limit,
bad signature, malformed card). Inspecting only `response.ok` would report
these as success, so GitHub would not retry and the message would be lost
silently. awire parses the response body and treats `StatusCode !== 0` as
failure, returning 502 to GitHub so the delivery retries.

### Feishu signing signs an empty message

The custom-bot signature is `HMAC-SHA256(key = "${ts}\n${secret}", message = "")`
then base64. The message is the **empty string**, not the request body.
Many third-party implementations get this wrong and sign the body. The
`signFeishu` function has a doc comment calling this out specifically
because it is the most common bug.

### HTMX + server-rendered fragments, not a SPA

The panel is CRUD over two small collections. A React SPA would add a build
chain, ~250 KB of JS, client-side routing, and a JSON API layer that
duplicates the fragment layer. HTMX gives SPA-like partial swaps with the
worker returning HTML directly from the same handlers. The Tailwind output
is built at deploy time and inlined into the shell, so there is no runtime
CDN dependency and no flash of unstyled content.

### Constant-time token comparison

`verifyPanelToken` uses `crypto.subtle.timingSafeEqual` rather than `===`.
A timing side-channel on a Bearer token comparison would let an attacker
recover the token byte by byte with enough requests. On Workers the
practical risk is low (network jitter dominates), but the constant-time
version is free and the right default for an open-source project that will
be audited.

### Panel at a non-guessable path

The panel sits at `/<PANEL_PATH>` where `PANEL_PATH` is a Worker secret
like `_panel_k4m9z2x7`. This is not authentication — it is obscurity that
reduces attack surface. Real auth is the Bearer token / session cookie.
Both are required: a request to `/<PANEL_PATH>` without a valid token still
gets a login page, not the dashboard.

## Module map

| Path | Responsibility |
|---|---|
| `src/index.ts` | Fetch entry; routing; webhook + panel dispatch |
| `src/verify.ts` | GitHub HMAC-SHA256 signature verification |
| `src/dedup.ts` | Delivery dedup (DEDUP_KV, atomic check-and-mark) |
| `src/config.ts` | KV config load/store; index pattern; event filter |
| `src/feishu.ts` | Feishu webhook client + custom-bot signing |
| `src/render/*.ts` | Pure payload → FeishuCard renderers, one per event domain |
| `src/panel/html.ts` | Panel shell + login page HTML |
| `src/panel/auth.ts` | Token verify (constant-time) + cookie/header extraction |
| `src/panel/api.ts` | Panel CRUD handlers, returning HTML fragments |
| `src/panel/fragments/*.ts` | HTMX fragment renderers (dashboard, channels, repos) |
| `src/types.ts` | KV schema, GitHub payload, Feishu card types |

## What is deliberately not here

These are V2 concerns. The architecture leaves room for them; the code does
not implement them.

- **Feishu rate-limit coalescing.** V1 sends synchronously; a burst can hit
  the 5/sec/bot limit. V2 will introduce a Queue consumer that batches and
  merges. Renderers are pure functions today specifically so they can be
  batched tomorrow.
- **Multi-channel fan-out.** Today one repo maps to one channel. The
  `RepoConfig.channel_id` field will widen to `channel_ids: string[]`;
  see `docs/pinged-comparison.md` for the migration sketch.
- **Per-repo webhook route token.** Today routing is by repo full name from
  the payload. A `/hook/github/<token>` entry point would add defense in
  depth.
- **GitHub OAuth multi-user.** V1 is single-user by design; the panel auth
  layer is isolated so V2 can swap in OAuth without touching the webhook
  path.
- **New sources (GitLab, Jira) and sinks (Slack, Discord).** The directory
  structure (`render/`, `feishu.ts`) is named for the current adapters but
  is not architecturally bound to them; a source/sink abstraction is the
  first step of V2.
