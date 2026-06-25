# awire Release

awire releases are the source boundary for generated clients. Lathe consumers must pin an immutable awire tag or 40-character SHA, never a branch.

The OpenAPI document does not hard-code a deployment host. Generated CLIs should use `--hostname`, `AWIRE_HOST`, or a downstream `default_hostname` in `specs/sources.yaml`.

## Local gate

Run:

```sh
pnpm check:openapi
pnpm typecheck
pnpm deploy:dry
```

If the JSON API changed, regenerate the checked-in OpenAPI document before committing:

```sh
pnpm gen:openapi
pnpm check:openapi
```

Also smoke the authenticated endpoint:

```sh
URL=http://localhost:8787 PANEL_TOKEN=<token> pnpm test:api
```

## Cut a release

1. Update `package.json` version.
2. Update `CHANGELOG.md`.
3. Commit the release change.
4. Create an annotated tag matching the package version:

   ```sh
   git tag -s v0.2.0 -m "v0.2.0"
   ```

5. Push the commit and tag.
6. Verify GitHub CI passes.
7. Deploy with runtime vars preserved:

   ```sh
   wrangler deploy --keep-vars
   ```

## Lathe source

After the tag exists, downstream CLI generation should point at the release:

```yaml
sources:
  awire:
    repo_url: https://github.com/samzong/awire.git
    pinned_tag: v0.2.0
    # Optional in the downstream CLI repo when the deployment host is stable:
    # default_hostname: awire.<account>.workers.dev
    backend: openapi3
    openapi3:
      files:
        - openapi/awire.yaml
```

Validate the generated CLI before publishing it:

```sh
lathe bootstrap
go mod tidy
go build -o bin/awirectl ./cmd/awirectl
bin/awirectl commands --json
```
