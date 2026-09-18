# Operations

## Daemon model

Taskflow runs inside the Portta host daemon, one process per machine. It serves
every registered Project on one port and scopes each Project's routes and
sockets under that Project's URL prefix:

| Surface | Path on the daemon |
| --- | --- |
| Liveness, no token | `GET /api/health` |
| Global Project management | `/api/modules/taskflow/api/projects` |
| One Project's API | `/api/modules/taskflow/<prefix>/api/...` |
| Terminal socket | `/ws/modules/taskflow/<prefix>/ws/<worktree>` |
| Agent chat socket | `/ws/modules/taskflow/<prefix>/ws/agents/worktrees/<name>` |

The daemon serves no dashboard of its own. The dashboard is the panel's
Taskflow section; the panel checks the user's Portta permissions and forwards
the same paths to the daemon with its token. See [Dashboard](dashboard.md) and
[Run the host daemon](../../product/guides/host-daemon.md).

The module is part of the daemon: every `portta host serve` mounts it. A daemon
that answers its health check but a `404` for every Taskflow path is an older
one that predates the module; update Portta on the host and restart it.

For foreground use:

```bash
portta host serve
```

To start it in the background without a service manager:

```bash
portta host serve --detach
```

A detached daemon logs to `state/host/daemon.log`. If a daemon already answers
on the configured address, `--detach` reports it and starts nothing.

## Run it as a service

```bash
portta host service install
portta host service status
portta host service logs
portta host service restart
portta host service uninstall
```

The service is called `portta-host`, one per machine:

| Platform | Unit | Logs |
| --- | --- | --- |
| Linux | systemd user unit `~/.config/systemd/user/portta-host.service` | `journalctl --user -u portta-host` (what `logs` follows) |
| macOS | launchd agent `com.portta.host`, `~/Library/LaunchAgents/com.portta.host.plist` | `~/Library/Logs/portta-host.log` |

The unit runs `portta host serve` from the installation with `PORTTA_ROOT` set,
so the daemon reads the same installation `.env` a foreground start does. Only
what a service manager would otherwise lose is written into the unit: `PATH`,
and credentials people keep in a shell profile.

## Service environment

Pass values at installation time:

```bash
portta host service install --env LINEAR_API_KEY=lin_api_... --yes
```

`--env` is repeatable. Unless `--no-auto-env` is given, the installer also
carries `LINEAR_API_KEY` from the current shell into the unit. `PATH` and
`PORTTA_ROOT` are written by the generator and cannot be set with `--env`.
`-y`/`--yes` skips the confirmation.

Or keep the value in the installation's `.env` and restart:

```bash
$EDITOR ~/portta/.env
portta host service restart
```

## The token

Every request to the daemon except `GET /api/health` must carry:

```text
Authorization: Bearer <contents of state/host/token>
```

The same check applies to HTTP, server-sent events and WebSocket handshakes.
The token file is created once, with mode `0600`, the first time the daemon or
`portta up` needs it, and is never rewritten. Whoever can read it can drive a
process that runs commands on the host, so it is never put in `.env`, a
response or a log.

Three readers use the same token and nothing else:

- the panel, which mounts the file read-only and adds the header itself after
  checking the user's Portta permissions;
- `portta flow` commands, `portta doctor` and `portta mcp`'s Taskflow tools,
  which read it from the state directory; and
- agent hooks, which receive it in the worktree's `control.env` as
  `PORTTA_FLOW_CONTROL_TOKEN` to report runtime events.

There is no second, remote-access token, and the daemon never rotates this one.

## Binding

Loopback is the default: `127.0.0.1:5111`. Change it with `PORTTA_HOST_BIND`
and `PORTTA_HOST_PORT` in the installation's `.env`; see
[Module and daemon variables](configuration.md#module-and-daemon-variables).

On Docker Desktop, a panel container reaches the host's loopback, so the
default works. On Linux the panel reaches the host at the Docker bridge gateway,
so the daemon binds that address:

```bash
PORTTA_HOST_BIND=172.17.0.1
```

A non-loopback bind is protected by the same token. Never bind `0.0.0.0`: the
token would then be the only thing between every network the host is on and a
shell. A firewall that allows the port only from the bridge is a sensible
second layer.

Agent hooks reach the daemon at `PORTTA_HOST_BIND` (or `127.0.0.1` when the bind
is a wildcard) on `PORTTA_HOST_PORT`; Docker runtimes rewrite a loopback
address to `host.docker.internal`.

## Project allowlist

Restrict which canonical roots can be added as Projects:

```bash
PORTTA_FLOW_PROJECT_ALLOWLIST='/srv/code:/opt/projects'
```

The default is the current user's home directory. Configure a narrower set on
shared machines, or wherever the panel is reachable by people other than you.

## Remote access

The daemon speaks HTTP and is not meant to be exposed. Reach Taskflow remotely
through the Portta panel, which is published, authenticated and routed the way
the rest of Portta is; see [Remote development](../../product/guides/remote-development.md)
and [Authentication](../../product/guides/authentication.md). The panel's proxy
already supports what Taskflow needs: WebSocket upgrades for terminals and chat,
long-lived server-sent events for notifications and Run streams, and streamed
uploads.

## Data and backup

Machine-wide state lives in the daemon's state directory,
`PORTTA_HOST_STATE_DIR`, by default `state/host` under the installation; its
contents are listed in [Global data paths](configuration.md#global-data-paths).
Machine secrets such as `LINEAR_API_KEY` live in `$PORTTA_HOME/.env`.

Back up the database, run directory, and saved workflows together when Run history matters. Active multiplexer processes are runtime state, not a portable backup.

Project configuration and workflows under `.portta/` should normally be version-controlled, except `.portta/taskflow.local.yaml` and secrets.

## Shutdown and recovery

Taskflow reconciles active Runs and worktree sessions when the daemon starts. tmux/herdr processes and the ACP supervisor may outlive the daemon. Direct Sessions whose provider/checkpoint remains available can resume; Workflow Runs whose engine process disappeared become interrupted and can replay from their journal.

Before planned maintenance, avoid switching multiplexers or deleting worktrees with active exclusive Runs. After restart, inspect:

```bash
portta host service status
portta flow list --all
portta flow runs list
```
