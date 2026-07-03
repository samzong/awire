# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-03

### Added
- Slack and Telegram delivery channels alongside Feishu/Lark.
- GitHub OAuth panel login with per-account workspaces.
- Account-wide repository routes with `owner/*`.
- Root-mounted hosted panel for the public demo at `https://awire.samzong.workers.dev`.
- Cloudflare deployment runbook with one-click deploy notes, manual Wrangler
  deployment, OAuth setup, KV setup, and troubleshooting.
- Bundled `awirectl skill install` support.
- Webhook delivery diagnostics for Cloudflare Workers logs.

### Changed
- Moved the public health endpoint to `/health`.
- Reworked README around the hosted demo, supported sources/channels, current
  architecture, and Cloudflare self-hosting entry point.
- Updated panel copy to show the GitHub webhook Payload URL in repo setup.
- Stamped generated CLI builds with version metadata.
- Refined generated CLI overlay docs and safe flag input guidance.

## [0.1.0] - 2026-06-25

### Added
- Initial public release.
- GitHub webhook ingestion at `POST /hook/github` with HMAC-SHA256
  verification (`crypto.subtle.verify`, constant-time).
- Delivery dedup via a dedicated `DEDUP_KV` namespace, 10-minute TTL,
  atomic check-and-mark before send.
- Configurable routing: repos → channels, three-granularity event filters
  (`*`, `<event>`, `<event>.<action>`).
- 15 specialized Feishu card renderers + a generic fallback covering every
  remaining GitHub event.
- Feishu client that inspects the business `StatusCode` field (not just
  HTTP status) to correctly detect rate-limit and signature errors.
- HTMX + Tailwind admin panel with login (session cookie or Bearer token),
  dashboard, channels CRUD with "test send", repos CRUD with event matrix.
- JSON management API at `/api/v1/*` with a checked-in OpenAPI document
  (`openapi/awire.yaml`) for downstream client generation.
- Generated `awirectl` CLI (Lathe) for operating the JSON API from the shell.
- `pnpm build:cli` and `pnpm install:cli` scripts to build and install the CLI
  into `~/.local/bin`.
- Open-source readiness: LICENSE (MIT), CONTRIBUTING, SECURITY,
  CODE_OF_CONDUCT, GitHub issue/PR templates, CI workflow.
- `prepare` script so `pnpm install` rebuilds `src/panel/generated-css.ts`.
  The generated CSS file is gitignored — clone, install, deploy works
  without a manual build step.
- `docs/ARCHITECTURE.md` documenting the request lifecycle and design decisions.
- `docs/RELEASE.md` documenting the release and Lathe source boundary.
- `docs/pinged-comparison.md` recording feature gaps versus the retired
  predecessor (`pinged`) and the verdict on each.
- Scripts: `gen-secret` (token/path/webhook secret), `test-webhook`
  (signed smoke test), `test-api` (JSON API smoke test),
  `build-panel-css` (Tailwind → inlined TS module).

### Changed
- Panel header simplified with a GitHub repository link.
- `.gitignore` now also excludes `.local/`, `.serena/`,
  `scripts/samples/` (test fixtures regenerated locally), and generated
  Worker/CSS artifacts.
- `dev` script now builds CSS before starting wrangler, matching `deploy`.

[Unreleased]: https://github.com/samzong/awire/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/samzong/awire/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/samzong/awire/releases/tag/v0.1.0
