---
name: awirectl
description: >
  Use when operating the awirectl generated CLI. Discover commands, inspect parameters,
  check auth state, and execute API operations safely.
---

# awirectl CLI

Use this skill when a user asks you to operate `awirectl`, inspect its API commands, or find the right generated command for an API task.

## Workflow

1. Search for candidates with `awirectl search "<intent>" --json`; use `--limit` when needed. Search is only candidate discovery.
2. Inspect the exact command with `awirectl commands show <path...> --json` before executing an unfamiliar command.
3. If the command detail has `auth.required=true`, run `awirectl auth status --hostname <host>` before execution. Use `http.default_hostname` when present unless the user provides `--hostname` or `$AWIRECTL_HOST`.
4. Execute only after flags, body, auth, HTTP path, and output hints are clear from `commands show`.

## General Commands

- `awirectl commands --json`: full generated command catalog.
- `awirectl commands --include-hidden --json`: include hidden generated commands.
- `awirectl commands show <path...> --json`: source of truth for one command.
- `awirectl commands schema --json`: catalog schema version for parser compatibility.
- `awirectl search "<intent>" --json`: ranked candidate commands.

## References

- Read `references/catalog.md` for the command discovery protocol and catalog field meanings.
- Read `references/modules/awire.md` for the `awire` module command index.

## Rules

- Do not guess flags or request body shape from command names.
- Do not execute directly from search results; confirm with `commands show` first.
- Prefer `-o json` for machine-readable command output unless the user asks for human-readable output.
- Use `--file`, `--set`, or `--set-str` for JSON request bodies according to `commands show` body requirements.
