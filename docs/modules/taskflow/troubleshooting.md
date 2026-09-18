# Troubleshooting

## Start with diagnostics

```bash
portta doctor
portta flow doctor
portta flow workflows doctor
```

`portta doctor` checks the machine: whether the host daemon answers and accepts this installation's token, and whether Git, Node.js, Python 3, tmux or herdr, `gh`, Docker, the Dev Containers CLI, Claude and Codex are available. `portta flow doctor` checks the current Project's readiness as the daemon sees it. `portta flow workflows doctor` checks the workflow providers and lists every ACP provider in the registry, declared ones included, with the resolved adapter path or the reason it was not found.

Taskflow requires Node.js 24+. A package built for Node 24 may fail under Node 22 with dependency-loader errors before a command reaches its handler.

## `portta flow` is not a command

The `portta` on your `PATH` is older than this documentation, or is not the one this package installs. Check `portta version` and `which portta`, then reinstall the CLI (`npm install -g @codions/portta@latest`); from a checkout, run the launcher `./bin/portta`, which rebuilds the CLI from the sources.

## Project configuration is not found

Run from inside the intended Git repository and verify:

```bash
git rev-parse --show-toplevel
test -f .portta/taskflow.yaml
```

Use `portta flow init` to create the config. A registered path is canonicalized to the shared repository root, including when invoked from a linked worktree.

## The CLI cannot reach the host daemon

A command that needs the daemon prints:

```text
Could not reach the Portta host daemon at http://127.0.0.1:5111. Start it with `portta host serve` (or `portta host service install`).
```

Check whether anything answers, and what the service manager says:

```bash
curl -s http://127.0.0.1:5111/api/health
portta host service status
portta host service logs
```

Start it with `portta host serve --detach` or `portta host service install`. The CLI reaches `PORTTA_HOST_BIND` (or `127.0.0.1` for a wildcard bind) on `--port`, then `PORTTA_HOST_PORT`, then 5111; a daemon started with other settings in a different `.env` is not the one the CLI looks for. Pass the port explicitly to confirm:

```bash
portta flow --port 5111 project ls
```

## The daemon answers `401`

The daemon checks every request except `GET /api/health` against `state/host/token`. A `401` means the caller sent no token or a different one:

- `portta flow`, `portta doctor` and `portta mcp` read the token from `PORTTA_HOST_STATE_DIR`, or `state/host` under the installation. Run them from the installation that started the daemon, or point `PORTTA_HOST_STATE_DIR` at its state directory.
- A daemon started from another installation, or with another `PORTTA_HOST_STATE_DIR`, has its own token. Restart it from this installation with `portta host service restart`, or stop it and run `portta host serve`.
- A script calling the daemon directly must send `Authorization: Bearer <contents of state/host/token>`; no query parameter or other header is accepted.

`portta doctor` reports "refuses this installation's token" in this case, and "has no token this CLI can read" when the file does not exist where the CLI looks.

## The daemon answers `404` for Taskflow

The daemon is older than this CLI and predates the module: `portta doctor` reports it "is older than this CLI and serves no Taskflow route". Update Portta on the host, then restart the daemon (`portta host service restart`, or stop and rerun `portta host serve`). A service runs `portta host serve` from the installation named by `PORTTA_ROOT` in its unit, so that is the installation to update.

## The panel's Taskflow pages fail

The panel forwards to the daemon and names the failure:

- `502` — nothing answered at `PORTTA_HOST_URL`. Start the daemon. On Linux, a daemon bound to `127.0.0.1` is not reachable from the panel container; bind the Docker bridge address, for example `PORTTA_HOST_BIND=172.17.0.1`. See [Run the host daemon](../../product/guides/host-daemon.md#docker-desktop-and-linux).
- `503` — the panel has no `PORTTA_HOST_URL` or cannot read the token. Both come with the panel: run `portta up` (or `portta web up`) again so the panel container is recreated with them; the token file is created before the panel starts.
- `403` — the signed-in user lacks the Taskflow permission the route needs. See [Access and permissions](dashboard.md#access-and-permissions).

## tmux problems

- Confirm tmux is installed and starts outside Taskflow.
- Avoid testing against your personal live tmux server. Contributors should use the repository's isolated tmux script and socket variables.
- If a saved session is closed, use `portta flow open <branch>` or `portta flow restore`.
- After a profile/multiplexer switch, restart dev servers because arbitrary pane processes are not migrated.

## herdr problems

Print the selected adapter with `portta flow multiplexer`. Switch back to tmux to distinguish adapter issues from Project/session issues:

```bash
portta flow multiplexer tmux
portta flow open <branch>
```

Switching adapters rebuilds layouts. It cannot preserve scrollback or running processes.

## Agent command is unavailable

Validate built-in provider CLIs directly and run:

```bash
portta flow workflows doctor
```

For Docker profiles, inspect the image's non-login `PATH`; installing an agent only from `.bashrc` or another interactive shell file is insufficient. For custom agents, check `startCommand` and `resumeCommand` in `.portta/taskflow.local.yaml`.

## OpenCode or Pi rejects the sandbox

Both providers require explicit full access:

```js
agent("...", {
  provider: "opencode",
  model: "provider/model",
  sandbox: "danger-full-access",
})
```

This is intentional: their CLIs cannot enforce Taskflow's read-only or workspace-write confinement.

## Workflow is missing or blocked

```bash
portta flow workflows list
portta flow workflows validate <file-or-name>
```

Project workflows shadow user and built-in workflows. Same-tier duplicate `meta.name` values create a collision instead of an arbitrary winner. Files must be JavaScript and begin with pure-literal metadata.

## Workflow resume fails

Resume requires an interrupted Run, its source snapshot/journal, and an attached workspace. Inspect:

```bash
portta flow runs show <run-id>
portta flow runs transcript <execution-id>
```

An edited catalog file does not alter a durable Run; Taskflow resumes the snapshot. Standalone engine runs additionally require compatible source/input metadata for journal replay.

## Direct Session cannot resume

The execution must advertise resume capability, retain a provider session/checkpoint, and still own an available workspace. Provider-native session files are required. If only the multiplexer layout disappeared, reopen the worktree instead of creating a new conversation.

For oneshot, `--resume` requires a follow-up `--prompt`; use the dashboard when you only want to reattach without prompting.

## Service health badge is down

Check the allocated environment inside the worktree and compare it with `services[].portEnv`. Ensure the development command binds to the allocated port and that `urlTemplate` expands to a reachable address.

Do not hard-code one Project-wide port for all worktrees. Use the injected environment variable.

## Environment panel is failed or has no services

Run:

```bash
portta flow environment <branch> status
portta flow environment <branch> doctor
portta flow environment <branch> services
```

`detected` means the worktree has been recognized but has not been started; open it or run `portta flow environment <branch> start`. A Dev Container, Compose, or Dockerfile provider resolves files from the **worktree**, not the repository's current checkout. If its branch predates `.devcontainer/devcontainer.json`, `compose.yaml`, or `Dockerfile`, the panel remains visible as `failed` and names the missing manifest. Create/open a worktree from a branch containing that file, select a different provider, or add an explicit `environment.config` when multiple Dev Container configurations exist.

Container ports are not Docker host ports. With the default `autoExpose: all`, Taskflow creates private loopback endpoints after startup; use `portta flow environment <branch> services` to inspect them. If the project selects `autoExpose: manual`, use the environment service card or `portta flow environment <branch> expose <service>`, then use `open` to launch it. `portta flow environment <branch> monitor` is the Runtime pane's startup-safe command; `logs --wait` is available for direct log following. Use `portta flow environment <branch> service <service> start|stop|restart` when the service card indicates that individual control is supported.

## Git fails inside a Dev Container, or the container refuses to start on a worktree

`fatal: not a git repository` inside a Dev Container means the worktree's `.git` file points at an absolute host path that does not exist in the container. Taskflow rewrites the links of the worktrees it created automatically, in both directions. For any other worktree, its owner can run the command below — note that it repairs **every** linked worktree of the repository, not only the one named:

```bash
git -C <worktree> worktree repair --relative-paths
```

A `Dev Container preflight` error at start is that same check refusing to open a container on a checkout where Git would be broken or point at the wrong repository. The message names the cause — an absolute `gitdir` link, or a custom `workspaceMount` in the Dev Container configuration, which makes the Dev Containers CLI ignore `--mount-git-worktree-common-dir`. See [Git inside a linked worktree](dev-containers.md#git-inside-a-linked-worktree).

## Docker session fails

Verify Docker is running, the configured image exists, agent binaries are on `PATH`, writable mounts are intentional, and host paths exist. Authentication directories mounted read-only cannot be updated by provider CLIs; mount writable only when required and trusted.

## GitHub information is missing

```bash
gh auth status
gh pr status
```

Taskflow treats `gh` as optional. Confirm the worktree branch has a remote PR and that linked repository slugs/paths are correct.

## Linear issues are missing

Confirm `LINEAR_API_KEY` is visible to the host daemon, not only the current shell. Put it in the installation's `.env`, or reinstall the service from a shell that exports it, then:

```bash
portta host service restart
portta host service logs
```

Check `integrations.linear.enabled`, `watchTeams`, assignment/status, and required labels for auto-create. Remove and re-add an automation label to intentionally retrigger an already processed issue.

## Collecting useful debug evidence

Set `PORTTA_FLOW_DEBUG=1` in the environment the daemon reads, restart it, reproduce once, and capture the relevant service/Project/Run identifiers and timestamps. For code changes, add temporary logs at each uncertain branch and I/O boundary, reproduce the problem, then remove the logs after the cause and fix are verified.
