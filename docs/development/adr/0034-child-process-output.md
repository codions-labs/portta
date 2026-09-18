# 0034. A child process is never silent for long

**Status:** Accepted

The CLI invokes child processes through one adapter. Interactive builds and
pulls stream output. Captured commands report elapsed time after ten seconds
and periodically afterward. `--verbose` streams all child output, `--quiet`
suppresses progress, and `--json` keeps stdout reserved for machine data.

Commands are executable-plus-argument-array calls with no shell expansion.
Long builds are not killed by an arbitrary timeout; cancellation is left to
the caller.

## The CLI's output contract

The CLI is both an operator interface and an automation protocol, and a child
process's output is folded into that contract rather than around it:

- Requested data is the only content written to stdout under `--json`.
- Prompts and narration use stderr and never appear without a TTY.
- Confirmation is No by default; `--yes` is the explicit automation path.
- `--quiet` suppresses narration, not errors or requested data.
- Command names, aliases, help and exit codes are Commander-owned.

See the [CLI reference](../../product/reference/cli.md).
