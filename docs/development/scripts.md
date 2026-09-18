# Shell scripts

Portta has one product implementation: the TypeScript CLI in `packages/cli`.
New commands and operational behavior belong there, with shared derivations in
`packages/core`. Product shell code must not duplicate a command, validation,
default or configuration writer.

The repository contains only these deliberate shell boundaries:

| Path | Purpose |
|---|---|
| `scripts/lib/runner-exec.sh` | Fixed entrypoint inside the isolated project-runner image |
| `tests/**/*.sh` | Docker-backed assertions and their test-only helpers |
| `docker/images/sandbox/**/*.sh` | The sandbox image's build context: agent installers, the entrypoint and the verification script, run inside the image |
| `packages/host/tests/support/*.sh` | Test-only tmux isolation for the host daemon's suites |

`bin/portta` is a Node launcher. In a checkout it rebuilds `packages/cli` when
the source is newer than the bundle, then executes that same bundle. In an npm
installation, the package's `bin` entry executes the bundled CLI directly.

## Adding behavior

Add a command under `packages/cli/src/commands/` and a colocated test. Invoke
external programs through `runProcess`, passing an executable and argument
array. Use `packages/core` when a pure rule has more than one consumer.

A new shell file needs an actual process boundary that cannot live in Node; a
preference for shell syntax or a call to Docker, Git, SSH, OpenSSL or curl is
not such a boundary.

## Validation

Run the command's targeted Vitest file and `npm run build --workspace=@codions/portta`
when the executable or packaging changes. `tests/lint.sh` runs ShellCheck over
`scripts/` and `tests/`; the sandbox image scripts and the host test helper are
outside its scope. The executable bit is required only for `bin/portta`.
