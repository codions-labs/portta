# Installation reference

Installation is `portta setup` from the npm release, which requires Node 24+:

```bash
npm install -g @codions/portta
portta setup
```

`npx @codions/portta setup` runs the same setup without a global install.
`latest` is the release channel and needs no tag. An exact version such as
`@0.1.0` pins one release. Two pre-release channels exist for testers: `@next`
holds what `main` holds and `@dev` what `develop` holds; neither is the
recommended path.

After setup, the globally installed `portta` finds the installation in
`PORTTA_HOME`, `~/portta`, `/opt/portta`, `~/.portta` or `/var/lib/portta`, or
by walking up from the current directory. An installation elsewhere needs
`PORTTA_HOME` exported; setup prints that line when it applies.

## Setup flags

| Flag | Meaning |
|---|---|
| `--dir <path>` | Installation directory; defaults to an existing installation or `~/portta` |
| `--profile <name>` | `local` (default), `remote-private` or `remote-public` |
| `--dry-run` | Validate prerequisites and print the plan without changing files or Docker |
| `--skip-pull` | Use images already present on the host |
| `--yes` | Confirm setup non-interactively |
| `--json` | Emit the setup result as JSON |

Setup requires a POSIX host, Node 24+, npm, Docker Engine 24+ and Compose v2
(generated runtime overlays need Compose 2.24.4 or newer). It tells a missing
`docker` command apart from a daemon that does not answer. It never installs
system packages, invokes `sudo`, edits the firewall or writes outside the
selected installation.

The npm package contains the Compose files, image contexts, templates,
configuration defaults, version and runner entrypoint. Setup asks one
confirmation (`--yes` skips it), copies those assets and a copy of the CLI into
`<dir>/bin/portta` (the applier's entry point; the command you run is the
global `portta`), prepares `.env` from `.env.example` (missing keys are added,
configured values are kept, `PORTTA_AUTH_SECRET` is generated when empty),
preserves gateway state and current dynamic configuration, creates the `state/`
directories and the shared network, pulls pinned images, starts the selected
profile and checks that a component stayed running. It ends with a short
message: the installation directory, `portta web up` for the panel and
`portta doctor` for a check.

Setup starts the gateway only. The template ships `PORTTA_WEB=false`,
`PORTTA_WEB_EXPOSE=local` and `PORTTA_AUTH_MODE=disabled`, so no panel runs and
no setup address is printed until you enable it with `portta web up`. See
[Configuration](configuration.md).

An unrelated non-empty directory is refused. Repeating setup on an installation
updates runtime assets while preserving `.env`, state and operator-owned files.
