# Feature gaps learned from pinged (predecessor)

> Internal analysis. `awire` is the successor to `pinged` (a GitHub→Feishu
> relay that was retired). This document records features `pinged` had that
> `awire` does **not** yet implement, with a recommendation for each.
>
> Not every gap is worth closing — some `pinged` behaviors were deliberately
> dropped because they were unsafe or over-engineered. Each item below states
> the verdict explicitly.

## Summary

| # | Feature | pinged | awire | Verdict |
|---|---|---|---|---|
| 1 | Multi-channel routing (1 repo → N channels) | ✅ `channel_ids: string[]` | ❌ `channel_id: string` | **Port** — high product value |
| 2 | Per-repo webhook route token (`/hook/github/<token>`) | ✅ | ❌ | **Port** — defense in depth |
| 3 | Configurable dedup TTL | ✅ `DEDUP_TTL_SECONDS` env | ❌ hardcoded 600s | **Skip** — pseudo-requirement |
| 4 | SHA-1 signature fallback | ✅ | ❌ | **Skip** — SHA-1 is deprecated |
| 5 | Cascade-delete channel from repos | ✅ | ❌ (blocks delete if used) | **Keep awire's** — safer UX |

## 1. Multi-channel routing — PORT

`pinged` lets one repo fan out to multiple Feishu channels:

```ts
// pinged
interface Repo { channel_ids: string[]; /* ... */ }
const channels = await findChannelsForRepo(kv, repo);
const results = await sendToChannels(channels, message); // Promise.all
```

`awire` is 1:1:

```ts
// awire
interface RepoConfig { channel_id: string; /* ... */ }
```

### Why it matters
Real teams want the same repo to notify multiple groups: a dev channel
(all events) and an alerts-only channel (CI failures, releases). With the
current 1:1 model users must register the repo twice with separate GitHub
webhooks, which splits config and doubles signature-verification cost.

### Migration sketch
- `RepoConfig.channel_id: string` → `channel_ids: string[]`
- `resolveRoute` returns `{ channels: ChannelConfig[], ... }` and the
  handler fans out via `Promise.all(channels.map(sendCard))`.
- Partial-failure policy: if N-1 of N channels succeed, return 200 (don't
  force a retry that re-spams the working channels). Log the failures.
- Panel UI: multi-select instead of single `<select>`.

This is also the natural monetization seam (multi-channel = paid tier).

## 2. Per-repo webhook route token — PORT

`pinged` exposes two webhook entry points:

```
POST /hook/github              # route by payload.repository.full_name
POST /hook/github/<route_token> # route by URL token (per-repo secret)
```

`awire` only has the first. Routing purely by repo name means the URL is
public and guessable; security rests entirely on HMAC verification.

### Why it matters
Defense in depth. Even with HMAC, a per-repo unguessable URL token means
an attacker who forges a repo name cannot even reach the routing logic.
It also lets users rotate per-repo access without changing the shared
secret.

### Migration sketch
- Keep `/hook/github` as the default (backward compatible).
- Add `/hook/github/<token>`; `resolveRoute` accepts an optional token and
  prefers it over repo-name lookup when present.
- Store `route_token` on `RepoConfig`; generate on repo creation; allow
  rotation from the panel.
- Panel: show per-repo webhook URL with token included, copy-to-clipboard.

## 3. Configurable dedup TTL — SKIP

```ts
// pinged: env-driven, default 72h
export function dedupTtlSeconds(env) { /* parse DEDUP_TTL_SECONDS */ }

// awire: hardcoded
const DEDUP_TTL_SECONDS = 600;
```

### Why skip
The 10-minute window is an engineering constant, not an operator knob. It
is sized to GitHub's retry schedule (first few attempts are minutes apart),
not to a deployment preference. Exposing it as a config option:

- Adds a config surface and a way to misconfigure (too short → dedup fails
  its purpose; too long → KV accumulates dead keys).
- Solves no real problem — no operator has a legitimate reason to want a
  different window. "I want dedup to last longer during maintenance" is a
  rate-limiting concern, which belongs to V2 Queues, not to the TTL.

Hardcoding the constant in `src/dedup.ts` with a comment explaining the
choice is the right amount of flexibility. Re-evaluate only if a concrete
use case appears.

## 4. SHA-1 signature fallback — SKIP

`pinged` falls back to `X-Hub-Signature` (SHA-1) when SHA-256 is absent.

### Why skip
GitHub has defaulted to SHA-256 for years and SHA-1 is cryptographically
weaker. Supporting it widens the attack surface for no real compatibility
gain in 2026. `awire` should stay SHA-256-only and document the
requirement in the README.

## 5. Channel cascade-delete — KEEP AWIRE'S BEHAVIOR

`pinged.deleteChannel` silently strips the channel id from every repo
that references it. `awire` refuses the delete and shows which repos
still use the channel.

### Why keep awire's
Silent cascade leaves repos silently unnotified — users discover the
breakage when a critical alert never arrives. The block-and-hint UX is
strictly safer. Document this as intentional in CONTRIBUTING.

---

## What awire already does better than pinged (for reference)

These are *not* gaps — they are reasons awire exists:

- **Feishu business-status check**: `ok: resp.ok && statusCode === 0`.
  `pinged` only checked HTTP status, so rate-limit/sign/card errors were
  misreported as success and messages were silently lost.
- **Constant-time panel token comparison** (`crypto.subtle.timingSafeEqual`).
- **Atomic check-and-mark dedup** before send (no retry race window).
- **Dedup in a separate KV namespace** (different TTL, blast radius,
  write volume).
- **Channel "Test send" feature** in the panel (`pinged` had none).
- **Structured JSON logging** with delivery/event/action context.
- **Per-event-domain renderer files** with JSDoc vs. one 415-line file.
- **Tailwind built + inlined** (no runtime CDN dependency) vs. hand-rolled CSS.

## Recommended issue order

1. Per-repo route token — security win, isolated change.
2. Multi-channel routing — largest product/monetization value; do last
   because it touches types, KV writes, handler, and panel UI together.
