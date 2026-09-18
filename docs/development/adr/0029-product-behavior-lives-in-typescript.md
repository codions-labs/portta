# 0029. Product behavior lives in TypeScript

**Status:** Accepted

## Decision

The `portta` package is the only command implementation. Product shell is
limited to a small installer handoff and the fixed entrypoint of the isolated
runner image. Shell tests may drive real Docker scenarios but do not provide
runtime behavior.

Calls to Docker, Git, SSH, OpenSSL and other programs use the CLI process
adapter with explicit argument arrays. A command, parser, validation rule or
configuration writer must not be copied into shell.

## Consequences

- `packages/cli/src/cli.ts` is the canonical command tree.
- Removing or renaming a command happens there and in its consumers together.
- `docs/development/scripts.md` is the live inventory of permitted shell
  boundaries.
