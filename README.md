# awire

> One control plane for source events and delivery channels. Runs on Cloudflare Workers.

[![CI](https://github.com/samzong/awire/actions/workflows/ci.yml/badge.svg)](https://github.com/samzong/awire/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/samzong/awire/blob/main/LICENSE)

`awire` routes source events to delivery channels as interactive cards. The
first adapter set supports GitHub repository webhooks and Feishu (Lark) group
chat bots. Pure KV storage, an HTMX admin panel, no build step.

- **Single binary deploy** — `wrangler deploy`. No frontend build, no SQL migrations.
- **Pure KV** — config + dedup live in two KV namespaces. No D1, no database.
- **Source event coverage** — 15 specialized GitHub templates + a generic renderer.
- **Delivery dedup** — GitHub 5xx retries won't spam your chat.
- **Dark, responsive admin panel** — Tailwind + HTMX, ~30 KB gzipped, no SPA.

---

## Quick start

### 1. Prerequisites

- Node.js 20+
- pnpm (`npm i -g pnpm`)
- A Cloudflare account (`wrangler login`)
- A Feishu custom bot

### 2. Install

```bash
git clone https://github.com/samzong/awire.git awire
cd awire
pnpm install
```

`pnpm install` runs the `prepare` script, which builds the Tailwind CSS
bundle into `src/panel/generated-css.ts`. That file is gitignored — it is
always regenerated from `src/panel/tailwind.css` + `tailwind.config.cjs`,
so contributors never need to commit it.

### 3. Create the two KV namespaces

```bash
wrangler kv namespace create awire-config
wrangler kv namespace create awire-dedup
```

Paste both returned `id` values into `wrangler.jsonc` (replace the `<RUN: …>`
placeholders in the `kv_namespaces` block).

### 4. Generate and set secrets

```bash
pnpm gen:secret
```

This prints two Worker secrets plus an optional per-repo webhook secret. Set
the Worker secrets:

```bash
wrangler secret put PANEL_TOKEN
wrangler secret put PANEL_PATH
```

For local dev, copy them into `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
# then edit .dev.vars with the same two Worker secrets
```

### 5. Deploy

```bash
pnpm deploy
```

Note the deployed URL, e.g. `https://awire.<your-acct>.workers.dev`.

### 6. Open the admin panel

Visit `https://awire.<your-acct>.workers.dev/<PANEL_PATH>` and sign in with
your `PANEL_TOKEN`. From the panel:

1. **Channels** → *Add channel* → paste your Feishu webhook URL (and optional
   signing secret). Click **Test** to verify.
2. **Repos** → *Add repo* → enter `owner/name`, pick a channel, optionally add
   that repo's GitHub webhook secret, and check the events you want forwarded.
3. In **Repos**, use the **Default** row to optionally route repos without an
   explicit config.

### 7. Configure each GitHub repository

In GitHub → repo → **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://awire.<your-acct>.workers.dev/hook/github` |
| Content type | `application/json` |
| Secret | the optional secret configured for this repo in awire |
| Events | choose the events you want awire to receive |

GitHub sends a `ping` on save — if your route allows it, you'll see a
connection card in your Feishu group.

---

## Local development

```bash
pnpm dev                    # wrangler dev (local KV simulation)
```

In another terminal:

```bash
URL=http://localhost:8787 SECRET=<your-secret> pnpm test:webhook
URL=http://localhost:8787 SECRET=<your-secret> EVENT=pull_request_opened pnpm test:webhook
```

This sends a signed sample payload through the full pipeline. Open the panel
at `http://localhost:8787/<PANEL_PATH>` to manage config while it runs.

---

## Architecture

```
GitHub Repo ──webhook──► POST /hook/github
                              │
                    ┌─────────┴─────────┐
                    │  1. route (KV)    │  explicit repo config
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │  2. verify (HMAC) │  optional repo webhook secret
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │  3. dedup (KV)    │  delivery_id, TTL 10m
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │  4. filter        │  events allow-list
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │  5. render        │  15 templates + generic renderer
                    └─────────┬─────────┘
                    ┌─────────┴─────────┐
                    │  6. send to Feishu│  optional signing
                    └───────────────────┘
```

### Storage

Two KV namespaces, by concern:

| Namespace | Purpose | Lifetime |
|---|---|---|
| `CONFIG_KV` | channels and repos | permanent |
| `DEDUP_KV` | delivery_id markers | 10-minute TTL |

Config layout in `CONFIG_KV`:

```
channels:index   -> string[]                # list of channel ids
channel:<id>     -> ChannelConfig
repos:index      -> string[]                # list of "owner/name"
repo:<full>      -> RepoConfig
```

### Why two KV namespaces

Different TTL policies (permanent vs 10-min), different blast radius (user
config vs junk markers), different write volume. Cloudflare recommends
separating data with different lifetimes into different namespaces.

---

## Event coverage

All GitHub webhook events are covered. Specialized templates produce
purpose-built cards:

| Event | Rendered actions |
|---|---|
| `ping` | (always) |
| `issues` | opened / closed / reopened / labeled / assigned / unlabeled / unassigned |
| `pull_request` | opened / closed (merged vs unmerged) / reopened / ready_for_review / review_requested / converted_to_draft |
| `issue_comment` | created |
| `pull_request_review` | submitted (approved / changes_requested / commented) |
| `pull_request_review_comment` | created |
| `push` | always (with commit summary; caps at 5 shown) |
| `release` | published / prereleased / edited |
| `workflow_run` | completed (colored by conclusion) |
| `check_run` | completed |
| `deployment_status` | success / failure / pending |
| `star` | created |
| `fork` | always |
| `watch` | started |

Everything else (`label`, `milestone`, `organization`, `security_advisory`,
…) falls through to a generic card showing event + action + sender + any
linked issue/PR/comment.

Noisy actions (`pull_request.synchronized`, `pull_request.edited`,
`workflow_run.in_progress`, `star.deleted`, …) are dropped at the renderer
layer even when the event filter allows them.

---

## Configuration reference

### Channel (Feishu bot)

```jsonc
{
  "id": "<random>",
  "name": "Feishu · alerts",
  "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx",
  "sign_secret": "<optional, when bot signature verification is enabled>"
}
```

### Repo routing

```jsonc
{
  "full_name": "owner/name",          // stored lowercase
  "channel_id": "<target channel>",
  "events": ["issues.opened", "pull_request", "*"]  // 3 granularities
}
```

Event filter semantics:

| Pattern | Matches |
|---|---|
| `"*"` | every event, every action |
| `"issues"` | every action of the `issues` event |
| `"issues.opened"` | only the `opened` action |

## Security

- **Webhook signature verification** uses `crypto.subtle.verify` when a repo has
  an optional webhook secret configured. 401 on mismatch → GitHub does not retry.
- **Panel auth** accepts the Bearer token for API checks and a secure session
  cookie for browser navigation. The panel sits at a non-guessable path
  (`PANEL_PATH`).
- **Panel secrets** (`PANEL_TOKEN`, `PANEL_PATH`) live in Worker secrets, never
  in KV or source. Per-repo GitHub webhook secrets and per-channel Feishu
  signing secrets are stored in `CONFIG_KV` — rotate from the panel if
  compromised.
- **HTML rendering** escapes all user-supplied strings (`escapeHtml`).

---

## Limits & trade-offs

- **Feishu rate limit**: 5 messages/sec, 100/min per bot. `awire` does *not*
  coalesce bursts in V1. For high-traffic repos, either split across bots or
  await V2 (Queues-based coalescing).
- **KV eventual consistency**: a config change may take up to 60s to reach
  every edge. Webhooks during that window use the previous config.
- **No event log**: events are not persisted. The dedup window is the only
  state about past events.
- **Single user**: V1 has no multi-user auth. V2 will add GitHub OAuth.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| GitHub shows webhook as "last delivery failed" with 401 | GitHub webhook secret does not match the repo's optional secret in awire |
| No card in Feishu | Panel → Channels → Test. Verify sign_secret matches the bot's signature verification setting. |
| Duplicate cards | Dedup window is 10 min. GitHub may still retry after that — increase if needed. |
| Panel returns 401 | Session expired or token is invalid. Re-login at `/<PANEL_PATH>`. |
| `wrangler deploy` fails on KV ids | Fill in real namespace ids in `wrangler.jsonc` (step 3 above). |

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Build CSS, then run local dev server with KV simulation |
| `pnpm deploy` | Build CSS, then deploy to Cloudflare |
| `pnpm deploy:dry` | Build CSS, then validate without deploying |
| `pnpm build:css` | Rebuild `src/panel/generated-css.ts` from Tailwind source |
| `pnpm types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm gen:secret` | Print three random secrets |
| `pnpm test:webhook` | Send a signed sample payload |

---

## Roadmap

V1 is complete and deployed. The shortlist below is ordered by value;
`docs/pinged-comparison.md` records the full reasoning.

- **Per-repo webhook route token.** Add `POST /hook/github/<token>` as a
  defense-in-depth alternative to routing by repo name. Backward compatible.
- **Multi-channel fan-out.** Widen `RepoConfig.channel_id` to
  `channel_ids: string[]` so one repo can notify multiple groups with
  different event filters. This is the natural seam for a hosted tier.

Deliberately **not** on the V1.x roadmap:

- SHA-1 webhook signature fallback — deprecated and unsafe.
- A SPA admin panel — the HTMX design is intentional; see
  `docs/ARCHITECTURE.md`.
- Multi-user auth — planned for V2 alongside a hosted offering.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first —
it covers setup, the verification steps every PR must pass, and the
patterns to follow when adding a renderer or a channel.

For bug reports and feature requests, use the GitHub issue templates
(`Bug report` or `Feature request`). For security issues, see
[SECURITY.md](SECURITY.md) — do **not** open a public issue.

---

## License

MIT © samzong. See [LICENSE](LICENSE).
