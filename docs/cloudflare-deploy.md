# Cloudflare Deployment

awire can run on Cloudflare Workers. Cloudflare also provides a Deploy to
Cloudflare button for public Workers repositories, but awire still needs
account-specific KV namespaces, Worker secrets, a GitHub OAuth App, and at
least one delivery target.

Use the one-click flow as an import shortcut. Use the manual Wrangler flow as
the authoritative production deploy path for this repository.

## Deploy to Cloudflare button

Cloudflare's button can clone a public GitHub or GitLab Workers repository into
the deployer's account, configure a Worker, provision supported resources from
the Wrangler config, and run Workers Builds.

Markdown snippet for this repository:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/samzong/awire)
```

During setup, use these settings:

| Setting | Value |
| --- | --- |
| Root directory | `.` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build:css` |
| Deploy command | `pnpm exec wrangler deploy --keep-vars` |
| Worker name | `awire`, unless the setup flow rewrites `wrangler.jsonc` |
| Required KV bindings | `CONFIG_KV`, `DEDUP_KV` |

If the Cloudflare setup page pre-fills `pnpm deploy`, replace it with the
deploy command above. The repository's local `pnpm deploy` script uses
`wrangler.local.jsonc`, which is intentionally gitignored and will not exist in
a clean one-click clone.

The button is not enough by itself. After the Worker is deployed, finish the
runtime setup in the admin panel and in GitHub webhooks.

## Required accounts and tools

| Requirement | Why |
| --- | --- |
| Cloudflare account with Workers access | Hosts the Worker and KV namespaces |
| Node.js 22+ | Required by the current Wrangler 4.x toolchain |
| pnpm 11+ | Project package manager |
| GitHub account | Used for panel login and repository webhooks |
| GitHub OAuth App | Enables the browser admin panel login |
| Feishu custom bot, Slack incoming webhook, or Telegram bot | Delivery target for routed events |
| Admin access to each GitHub repository | Required to add repo webhooks |

## Manual production deploy

Install dependencies and authenticate Wrangler:

```sh
pnpm install
pnpm exec wrangler login
```

Create a local deployment config. Keep this file out of Git.

```sh
cp wrangler.jsonc wrangler.local.jsonc
```

Create the two KV namespaces:

```sh
pnpm exec wrangler kv namespace create awire-config
pnpm exec wrangler kv namespace create awire-dedup
```

Copy the returned namespace IDs into `wrangler.local.jsonc`:

```jsonc
{
  "kv_namespaces": [
    { "binding": "CONFIG_KV", "id": "<awire-config id>" },
    { "binding": "DEDUP_KV", "id": "<awire-dedup id>" }
  ]
}
```

Generate awire secrets:

```sh
pnpm gen:secret
```

Set Worker secrets. Use the interactive prompts; do not put secret values in
shell history.

```sh
pnpm exec wrangler secret put PANEL_TOKEN --config wrangler.local.jsonc
pnpm exec wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
pnpm exec wrangler secret put GITHUB_CLIENT_ID --config wrangler.local.jsonc
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.local.jsonc
```

`PANEL_TOKEN` and `SESSION_SECRET` come from `pnpm gen:secret`.
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` come from a GitHub OAuth App.
Use this callback URL:

```txt
https://<your-worker-host>/auth/github/callback
```

If you do not know the final Worker host yet, deploy once with
`PANEL_TOKEN` and `SESSION_SECRET`, read the Workers URL from Wrangler, create
the GitHub OAuth App, set the GitHub secrets, then deploy again.

Run a deploy dry-run against the local config:

```sh
pnpm build:css
pnpm exec wrangler deploy --config wrangler.local.jsonc --dry-run --keep-vars
```

Use the explicit dry-run command above while the real KV IDs live only in
`wrangler.local.jsonc`. The package-level `pnpm deploy:dry` reads the tracked
`wrangler.jsonc`.

Deploy:

```sh
pnpm deploy
```

Verify the public health endpoint:

```sh
curl https://<your-worker-host>/health
```

Expected response:

```json
{"ok":true,"service":"awire"}
```

## Runtime setup

Open the deployed Worker URL in a browser and sign in with GitHub.

In the admin panel:

1. Add a channel for Feishu, Slack, or Telegram.
2. Use the channel test action before wiring repositories.
3. Add a repo route for `owner/name` or `owner/*`.
4. Select the GitHub events awire should forward.
5. Set an optional per-repo GitHub webhook secret.

In each GitHub repository, add a webhook:

| GitHub webhook field | Value |
| --- | --- |
| Payload URL | Use the URL shown by the awire panel, usually `https://<your-worker-host>/hook/github/<account>` |
| Content type | `application/json` |
| Secret | The same optional repo webhook secret configured in awire |
| Events | Subscribe to the events awire should receive |

GitHub sends a `ping` delivery after the webhook is saved. Use that delivery as
the first end-to-end check.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cloudflare one-click build fails on missing `wrangler.local.jsonc` | Override the deploy command to `pnpm exec wrangler deploy --keep-vars` |
| Deploy fails on KV namespace IDs | Confirm `wrangler.local.jsonc` has real IDs for `CONFIG_KV` and `DEDUP_KV` |
| Panel login shows missing config | Confirm `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `SESSION_SECRET` are set on the Worker |
| GitHub webhook returns 401 | The GitHub webhook secret does not match the awire repo route secret |
| GitHub shows no delivery for an event | The GitHub webhook is not subscribed to that event; awire can only filter events GitHub sends |
| GitHub shows delivery but no chat card | Test the channel in awire, then check Cloudflare Worker logs with the GitHub delivery ID |

## References

- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers KV namespaces](https://developers.cloudflare.com/kv/concepts/kv-namespaces/)
