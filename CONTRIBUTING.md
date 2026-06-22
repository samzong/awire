# Contributing to awire

Thanks for considering a contribution. This guide keeps the project's quality
bar high and merges straightforward.

## Project status

awire is a young project. The maintainer is receptive to:

- Bug fixes with a reproducer.
- New GitHub event renderers (follow the pattern in `src/render/`).
- New delivery channels behind the existing source → channel abstraction.
- Documentation improvements.

The maintainer is **not** currently looking for:

- A frontend SPA rewrite. The HTMX + server-rendered panel is a deliberate
  decision; see `docs/ARCHITECTURE.md`.
- A D1 / SQL backend. Pure KV is the chosen storage model.
- Multi-user auth before the V2 design lands.

If your change is in the second category, open a discussion issue first so we
can align before you write code.

## Setup

```bash
git clone <your-fork> awire
cd awire
pnpm install          # runs `prepare`, which builds the Tailwind CSS bundle
pnpm dev              # wrangler dev with local KV simulation
```

You need Node.js 22+ (wrangler 4.x requires it) and pnpm 11+. No Cloudflare
account is required for local development; `pnpm dev` simulates KV locally.

## Before you open a pull request

1. **Typecheck passes.**

   ```bash
   pnpm typecheck
   ```

   The project uses strict TypeScript (`noUnusedLocals`,
   `noUncheckedIndexedAccess`, etc.). Match the existing style — no `any`
   unless you justify it in the PR description.

2. **`wrangler deploy --dry-run` succeeds.**

   ```bash
   pnpm deploy:dry
   ```

3. **The smoke test still passes against your local worker.**

   ```bash
   # terminal 1
   pnpm dev
   # terminal 2
   URL=http://localhost:8787 SECRET=anything pnpm test:webhook
   ```

   The `SECRET` here is the per-repo webhook secret; for local dev any value
   works as long as it is consistent with the route you are hitting. The
   sample fixtures are regenerated on first run under `scripts/samples/`
   (gitignored).

4. **No generated files committed.** `src/panel/generated-css.ts` and
   `worker-configuration.d.ts` are build outputs. The `prepare` script
   regenerates the former on `pnpm install`. Do not commit either.

5. **No secrets in diffs.** `.dev.vars` is gitignored. Real Feishu webhook
   URLs, GitHub tokens, and panel tokens must not appear in code, comments,
   or test fixtures. If you add a sample payload to `test-webhook.mjs`, use
   `octocat/Hello-World` style fixtures only.

## Code style

- **TypeScript strict.** No `// @ts-ignore`, no `as unknown as X` without a
  comment explaining why the type is wrong.
- **No module-level mutable state.** State goes through `env` (bindings) and
  `ctx` (execution context). This is what makes the worker safe across
  instance recycling.
- **Always `await` promises** from `fetch`, `crypto.subtle`, and KV. A
  floating promise in a worker is a silent drop.
- **Structured logs.** Use `console.log(JSON.stringify({ level, msg, ... }))`.
  The `observability` binding in `wrangler.jsonc` ships these to
  Cloudflare's log pipeline.
- **Doc comments at the top of modules.** Every file under `src/` opens with
  a `/** ... */` block explaining what the module is for and any non-obvious
  invariant. Match the density you see in `verify.ts` or `dedup.ts`.
- **Renderers are pure.** Functions in `src/render/` take a payload and
  return a `FeishuCard | null`. No I/O, no `env`, no side effects. This is
  what will make V2 batch rendering possible.

## Adding a new GitHub event renderer

1. Add the payload fields you need to `GitHubPayload` in `src/types.ts`.
   Type only the fields you render — the `[key: string]: unknown` index
   signature covers the rest.
2. Create `src/render/<event>.ts` exporting a `render<Event>(action, payload)`
   function returning `FeishuCard | null`. Use the helpers in `shared.ts`.
3. Wire it into the `switch` in `src/render/index.ts`.
4. Add the event to the `EVENT_GROUPS` matrix in
   `src/panel/fragments/repos.ts` so users can subscribe to it.
5. Add a sample fixture to `scripts/test-webhook.mjs` `DEFAULT_SAMPLES` and
   run `EVENT=<event>_<action> pnpm test:webhook` to verify.

## Adding a new delivery channel (e.g. Slack, Discord)

This is a larger change. Open an issue first. The current `feishu.ts` is
tightly coupled to the Feishu card schema; a channel abstraction needs
design before code.

## Commit messages

Conventional Commits, please:

```
feat(render): add pull_request_review_thread renderer
fix(feishu): inspect StatusCode field for business success
docs(readme): clarify panel auth model
chore(deps): bump wrangler to 4.104.0
```

## Pull request description

Include:

- **What** changed, in one sentence.
- **Why** it was needed (link the issue if any).
- **How you verified it** (typecheck, dry-run, smoke test output).
- **Breaking changes**, if any — including KV schema migrations, which
  require a migration note in the PR.

## Reporting a security issue

Do **not** open a public issue. Use the GitHub security advisory flow
described in `SECURITY.md`.

## License

By contributing, you agree your contributions are licensed under the MIT
license covering the project.
