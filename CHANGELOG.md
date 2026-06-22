# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source readiness: LICENSE (MIT), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT,
  GitHub issue/PR templates, CI workflow.
- `prepare` script so `pnpm install` rebuilds `src/panel/generated-css.ts`.
  The generated CSS file is now gitignored — clone, install, deploy works
  without a manual build step.
- `docs/ARCHITECTURE.md` documenting the request lifecycle and design decisions.
- `docs/pinged-comparison.md` recording feature gaps versus the retired
  predecessor (`pinged`) and the verdict on each.

### Changed
- `.gitignore` now also excludes `.local/`, `.serena/`, and
  `scripts/samples/` (test fixtures regenerated locally).
- `dev` script now builds CSS before starting wrangler, matching `deploy`.

## [0.1.0] - 2026-06-22

### Added
- Initial release.
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
- Scripts: `gen-secret` (token/path/webhook secret), `test-webhook`
  (signed smoke test), `build-panel-css` (Tailwind → inlined TS module).

[Unreleased]: https://github.com/samzong/awire/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/samzong/awire/releases/tag/v0.1.0
