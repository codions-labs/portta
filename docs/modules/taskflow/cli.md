# CLI reference

## Global syntax

```text
portta flow [--port N] <command>
portta flow <command> --help
```

`portta flow` is part of the Portta CLI. Every command prints its own usage, options, and examples with `--help`; a bare `portta flow` prints the command list. Unknown commands, unknown options, and invalid arguments print the error with a usage hint and exit with status `1`. `--port` goes before the command; options after a command belong to that command.

`--port` is the only flow-wide option: the port of the host daemon. Without it,
commands use `PORTTA_HOST_PORT`, then the default port 5111. The address is
`PORTTA_HOST_BIND` (a wildcard bind is reached on `127.0.0.1`), and the token is
read from the daemon's state directory, `PORTTA_HOST_STATE_DIR` or
`state/host` under the installation. Settings in the installation's `.env` apply
unless the shell exports its own.

When nothing answers, a command prints a hint to start `portta host serve` (or
`portta host service install`). Some commands
(`init`, `list`, `open`, `close`, `remove`, `merge`, `prune`, `restore` and
`multiplexer`) run the Taskflow runtime in the CLI process rather than
asking the daemon to, against the same state directory the daemon uses.

## The daemon, the service and the installation

Starting the daemon, installing its service, updating and printing the version
are Portta's commands, not `portta flow`'s:

| Command | Purpose |
| --- | --- |
| `portta host serve` | Run the host daemon in the foreground on `PORTTA_HOST_BIND:PORTTA_HOST_PORT` (default `127.0.0.1:5111`) |
| `portta host serve --detach` | Start it in the background, logging to `state/host/daemon.log`; does nothing when a daemon already answers |
| `portta host service install [--env KEY=VALUE]... [--no-auto-env]` | Install, enable and start the `portta-host` user service |
| `portta host service uninstall\|restart\|status\|logs` | Manage that service |
| `portta doctor` | Includes the Taskflow daemon and tool checks |
| `portta update` | Update the installation; see [Update Portta](../../product/guides/update.md) |
| `portta version` | Print the installed version |

See [Operations](operations.md) for the service details.

## Projects

### `init`

```text
portta flow init [--runtime=auto|devcontainer|compose|dockerfile|host]
                 [--devcontainer|--compose|--dockerfile|--host]
                 [--analyze=auto|claude|codex]
```

Creates `.portta/taskflow.yaml` at the Git root when absent, detects the environment strategy, and registers the Project. Detection is deterministic for valid Dev Container, Compose, and Dockerfile projects. When none is found, interactive `init` offers a restricted Claude or Codex **Analyze** pass to identify a host runtime and its development command. `--analyze=auto` is the non-interactive form for scripts: it uses Taskflow's default agent only for that unresolved host fallback, never for a deterministically detected provider. `--analyze=claude|codex` requests that agent directly. An explicit Analyze can adapt an existing config in place.

Run `portta flow init --help` for the four runtime choices and their short flags. `docker` is intentionally absent: it is a profile-level Docker runtime (`runtime: docker` plus `image`), not an environment inferred from a repository Dockerfile.

`init` registers the Project with the running daemon through its API. When no daemon answers, it writes the Project into `projects.json` in the state directory, and the daemon loads it on its next start.

### `project`

```text
portta flow project ls
portta flow project add [path]
portta flow project rm <prefix>
```

`add` defaults to the current repository and persists the Project. `list` and `remove` are aliases of `ls` and `rm`. These commands talk to the daemon.

### `doctor`

```text
portta flow doctor [--json]
```

Checks the current Project's readiness as the daemon sees it: the toolchain, the configured default agent, Codex oneshot auto-review, GitHub and Linear credentials, and Docker profiles. Integrations that are not configured are reported as skipped; a configured capability that cannot be used makes the command exit with code 1. Machine-wide checks (daemon reachability and token, required tools) are in `portta doctor`.

### `completion`

```text
portta flow completion bash
portta flow completion zsh
```

The scripts are generated from the command tree, so they complete every command, subcommand, worktree branch argument, and fixed argument choice. For example:

```bash
eval "$(portta flow completion zsh)"
```

## Worktrees

### Create

```text
portta flow add [branch] [--existing] [--base <branch>] [--profile <name>]
                [--agent <id>]... [--prompt <text>] [--env KEY=VALUE]...
                [--interface <terminal | web-chat>] [--detach]
                [--from-linear <issue-id>] [--branch <name>]
```

- Omit the branch to use configured automatic naming or a generated `change-<id>` name.
- `--existing` attaches an existing local or remote branch.
- Repeat `--agent` to start multiple configured agents.
- `--interface` picks the session UI: a terminal pane or the mobile-friendly web chat.
- `--from-linear ENG-123` seeds the task from the issue and any prior Taskflow/PR context; `--branch` overrides the branch it resolves to.
- `--detach` leaves the current terminal focus unchanged.

### Inspect and filter

```text
portta flow list [--all | --archived] [--search <text>]
```

The default list excludes archived worktrees. `--all` includes them and `--archived` shows only archived worktrees.

### Session lifecycle

```text
portta flow open <branch> [--interface <terminal | web-chat>]
portta flow close <branch>
portta flow refresh <branch>
portta flow restore
```

`close` removes the live multiplexer layout but preserves the worktree. `refresh` reconstructs a Codex terminal from saved chat. `restore` reopens the set of sessions saved before shutdown.

### Metadata and visibility

```text
portta flow archive <branch>
portta flow unarchive <branch>
portta flow label <branch> <label>
portta flow label <branch> --clear
portta flow profile <branch> <profile>
```

Changing the profile restarts an open layout and resumes the agent conversation. A closed worktree uses the new profile when next opened.

## Environments and services

```text
portta flow environment <branch> status|doctor|trust|services
portta flow environment <branch> start|stop|restart|rebuild|destroy|terminal|logs|monitor
portta flow environment <branch> exec -- <command> [args...]
portta flow environment <branch> logs [--wait]
portta flow environment <branch> service <service> <start|stop|restart>
portta flow environment <branch> expose <service>
portta flow environment <branch> open <service> [--copy]
portta flow environment <branch> revoke <endpoint-id>
portta flow environment --run <run-id> [action]
```

`env` is an alias of `environment`. The action defaults to `status`.

Use `status` to inspect the selected provider and lifecycle state. `services` lists the discovered catalog and user endpoints. `monitor` follows a container provider's logs, or opens the Runtime console for an unmanaged host environment. `logs --wait` is the lower-level log follower. `terminal` opens a provider-native shell. `service` controls one discovered Compose or Dev Container service when that provider can do so. `expose` creates a private local endpoint when `autoExpose: manual`; `open` opens an existing endpoint, and `--copy` copies its URL instead of launching a browser. `--run <run-id>` targets a Run environment instead of a worktree; the action then follows directly.

### Agent input and tabs

```text
portta flow send <branch> <prompt> [--preamble <text>]
portta flow send <branch> --prompt <text> [--preamble <text>]

portta flow tab <branch>
portta flow tab <branch> new
portta flow tab <branch> switch <tab-id>
portta flow tab <branch> close <tab-id>
```

`send` requires the host daemon. Tabs are forked agent conversations; the list marks the active tab.

### Finish or clean up

```text
portta flow merge <branch>
portta flow remove <branch>
portta flow remove <branch> --force
portta flow prune
```

`merge` merges into the configured main branch and removes the worktree. `remove` deletes the branch too, so it refuses a worktree with uncommitted changes or with commits that exist nowhere else; `--force` discards them. `prune` confirms before removing closed worktrees in the current Project; open worktrees are not pruned, and a worktree holding work that exists nowhere else is reported and kept.

### Multiplexer

```text
portta flow multiplexer
portta flow multiplexer <tmux | herdr>
```

The selection is written to `.portta/taskflow.local.yaml`. Switching closes and recreates open layouts: provider conversations resume, but terminal scrollback and arbitrary running processes do not. Restart the daemon afterwards with `portta host service restart`, or by restarting `portta host serve`.

## Autonomous worktree run

```text
portta flow oneshot [branch] --prompt <text> [--agent <id>] [--base <branch>]
                    [--profile <name>] [--env KEY=VALUE]... [--keep-open]
                    [--linear <issue-id | team-key>] [--branch <name>]
portta flow oneshot --resume <branch> --prompt <text>
```

Oneshot streams the conversation to stdout without changing tmux focus. The watcher runs in the daemon, so it survives CLI disconnection, and it closes the session when the agent terminates or opens a pull request unless `--keep-open` is used or browser interaction disarms the watcher.

Exit codes are `0` for PR/user takeover, `1` for idle completion without a PR, and `130` for Ctrl-C while the worktree continues running.

## Linear

```text
portta flow linear post <branch> <team-key> [--title <text>]
```

Creates a Linear issue in the selected team and attaches the worktree conversation. To round-trip an existing issue, start with `portta flow add --from-linear ENG-123` or `portta flow oneshot --linear ENG-123`.

## Durable Runs

```text
portta flow workflows [list]
portta flow run workflow <workflow-id> [options]
portta flow run direct --harness <agent> [options]
portta flow runs [list]
portta flow runs show <run-id>
portta flow runs cancel <run-id>
portta flow runs resume <run-id>
portta flow runs transcript <execution-id>
portta flow runs permission <run-id> <request-id> <option-id|deny>
```

Run creation options:

```text
--input <text>
--input-json <JSON-object>
--profile <name>
--workspace <worktree | branch | current>
--branch <name>
--base <branch>
--transport <native | acp>
--permission-mode <interactive | workspace | deny>
--mcp-json <JSON-array>
```

Direct mode additionally accepts `--harness`, `--provider`, and `--model`. `--branch` and `--base` imply an isolated worktree when no workspace is specified and are invalid with `--workspace current`.

ACP is opt-in. It uses a machine-local supervisor so browser, CLI, or daemon disconnection does not terminate the agent process. `runs permission` answers an interactive ACP tool request. See the [ACP runtime architecture](architecture.md#agent-client-protocol-runtime) for its separation from tmux and its restart guarantees.

## Standalone workflow tools

```text
portta flow workflows run <file.workflow.js | name> [options]
portta flow workflows save <file.workflow.js> [--project] [--force]
portta flow workflows validate <file.workflow.js | name>
portta flow workflows doctor
portta flow workflows guide
```

Install the authoring skill into your agents with the [Skills CLI](https://www.skills.sh):

```bash
npx skills add codions-labs/portta --skill portta-workflows -g
```

Standalone `workflows run` options include `--args`, `--args-file`, paired `--provider`/`--model`, `--effort`, `--sandbox`, `--cwd`, `--concurrency`, `--budget`, `--resume`, `--fake`, `--json`, `--open`, and `--no-serve`. `--provider` accepts the builtin ids only; a provider declared in `.portta/taskflow.yaml` is available to ACP-transport workflows, not to the standalone engine. It stores engine journals under `state/host/runs/<id>/`.

Use `portta flow run workflow` when the work must be a Project-scoped durable Run in the dashboard. Use `portta flow workflows run` for the lower-level standalone engine interface.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORTTA_HOST_PORT` | host daemon port used when `--port` is absent (default 5111) |
| `PORTTA_HOST_BIND` | address the host daemon listens on, and the CLI reaches it at (default `127.0.0.1`) |
| `PORTTA_HOST_STATE_DIR` | host daemon state directory, holding the token (default `$PORTTA_HOME/state/host`) |
| `PORTTA_FLOW_PROJECT_ALLOWLIST` | colon-separated canonical roots allowed for Project addition |
| `PORTTA_HOME` | the installation directory (`~/portta` unless `portta setup --dir` chose another) |
| `PORTTA_FLOW_DEBUG` | enable debug logging |

Runtime-only `PORTTA_FLOW_*` variables are documented in [Configuration](configuration.md).
