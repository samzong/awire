## Summary

<!-- One or two sentences. What does this PR change? -->

## Why

<!-- The problem this solves. Link an issue with "Fixes #123" or "Refs #123". -->

## How I verified it

- [ ] `pnpm typecheck` passes
- [ ] `pnpm deploy:dry` succeeds
- [ ] Smoke test run: `URL=… SECRET=… EVENT=… pnpm test:webhook` → output:
- [ ] No generated files committed (`generated-css.ts`, `worker-configuration.d.ts`)
- [ ] No real secrets, webhook URLs, or tokens in the diff

<!-- For UI changes, paste a screenshot of the panel before/after. -->

## Breaking changes

<!-- KV schema migration? Worker env var renamed? Existing config shape changed?
     If yes, describe the migration steps operators must take. If no, write "None". -->

## Notes for review

<!-- Anything reviewers should look at closely, or context that isn't obvious
     from the diff. Delete this section if not needed. -->
