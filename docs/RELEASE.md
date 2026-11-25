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
pnpm test:api
```

## Cut a release

`package.json` is the version source. Tags use `vX.Y.Z` or `vX.Y.Z-(alpha|beta|rc).N`, with no leading zeroes.
Start each prerelease stage at `.1`. The gate also accepts `.0`.
awire uses the L2 release tier because the Worker API and generated CLI share a public contract.
Use beta and release candidates before a stable release. During `0.y.z`, increment MINOR for incompatible changes.

Install git-cliff 2.14.1. Run these commands from the repository root with all tags fetched.
Use a new version for every publication.

1. Update `package.json` to the release version.
2. Generate the release section:

   ```sh
   git fetch origin --tags
   RELEASE_TAG="v$(node -p 'require("./package.json").version')"
   RELEASE_TAG="$RELEASE_TAG" node scripts/verify-release.mjs --generate
   ```

3. Insert that output below `## [Unreleased]` in `CHANGELOG.md`, above the previous release.
4. Preserve the generated text and the `## [X.Y.Z] - YYYY-MM-DD` heading.
5. Update the comparison links at the end of `CHANGELOG.md`.
6. Run the local gate and repository tests.
7. Commit the version and changelog with `chore(release): vX.Y.Z`, then merge the release preparation PR.
8. After separate owner authorization, create a signed tag on the merged release commit:

   ```sh
   RELEASE_TAG="v$(node -p 'require("./package.json").version')"
   git tag -s "$RELEASE_TAG" -m "$RELEASE_TAG"
   RELEASE_TAG="$RELEASE_TAG" node scripts/verify-release.mjs
   ```

9. If the gate passes, push that specific tag:

   ```sh
   git push origin "$RELEASE_TAG"
   ```

Pushing a `v*` tag starts `.github/workflows/release.yml`.
Its first job rejects invalid tags, manifest mismatches, missing release sections, and differences from git-cliff.
The gate compares only the current release section. Historical release notes remain unchanged.
Each section includes changes since the previous stable tag, including changes in earlier candidates.
Promotion to stable uses the same notes with the new version heading.
The recorded release date controls rendering, so a later workflow run does not change the expected text.
The gate rejects empty release notes before any build or publication job starts.

After the gate passes, the workflow runs tests, typecheck, OpenAPI validation, and a dry-run Worker build.
It creates a GitHub Release from the accepted changelog section.
Prereleases use `--prerelease --latest=false`. Stable releases use `--latest`.
The private package is not published to npm. The workflow does not deploy the Worker or publish CLI binaries.

Read the workflow result and the GitHub Release after the tag push.
If validation fails, correct the release preparation before publishing a new version.
Never move, rename, delete, or reuse a published tag.
After separate deployment authorization, run `pnpm deploy` with runtime variables preserved.

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
