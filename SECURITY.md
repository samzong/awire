# Security Policy

## Supported versions

Only the latest release line receives security fixes. There are no LTS
branches.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repo's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, the impact, and a reproducer if you have one.

You should receive an initial response within 72 hours. If you have not
heard back, a polite nudge in the same channel is welcome.

Please do not disclose the issue publicly until a fix has been released or
we have jointly agreed on a disclosure timeline (90 days is the default).

## Scope

These are in scope:

- Bypass of GitHub webhook signature verification (`src/verify.ts`).
- Bypass of panel authentication (`src/panel/auth.ts`).
- Secrets leaking into logs, responses, or KV values visible to other
  tenants.
- XSS or HTML injection in the admin panel (fragments under
  `src/panel/`).
- SSRF via stored webhook URLs.

These are **out of scope** by design and documented in the README:

- Denial of service via high-volume webhooks. The worker auto-scales and
  KV is the bottleneck; rate limiting is the operator's responsibility.
- Config data being visible to anyone with the panel token — that is the
  authentication model. Single-user V1.
- Feishu webhook URLs being discoverable. They live in `CONFIG_KV` behind
  the panel; if the panel is compromised this is by definition exposed.

## Hardening checklist for operators

When you deploy awire, verify these:

- `PANEL_TOKEN` and `PANEL_PATH` are set as Worker secrets (not in
  `wrangler.jsonc`, not in `.dev.vars` in production).
- `PANEL_PATH` is long and random — run `pnpm gen:secret --path` to
  generate one.
- Each GitHub repo has a webhook secret configured in awire's repo
  config (not just the shared `/hook/github` endpoint).
- The Feishu custom bot has signature verification enabled and the
  matching `sign_secret` is stored on the channel.
- `wrangler.jsonc` does not contain real secret values in committed form.

## Disclosure policy

- Acknowledge receipt within 72 hours.
- Work with the reporter on a fix and a release date.
- Credit the reporter in the release notes unless they prefer otherwise.
- Publish a GitHub Security Advisory with a CVSS score after the fix
  lands.
