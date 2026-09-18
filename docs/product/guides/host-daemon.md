# Run the host daemon

Some Portta features need the host itself: the `gh` session, `LINEAR_API_KEY`,
git worktrees, tmux sessions, agent CLIs and the project directories. The panel
runs in a container with none of those, so that work runs in a small daemon on
the host, `portta host serve`, and the panel reaches it through an authorised
proxy.

Issues always need it: the panel reads and writes GitHub and Linear issues
through the daemon ([Work with issues](issues.md)). Without it, issue views say
the host daemon is not reachable, and every other page keeps working. The
Taskflow module runs inside it too.

## Start the daemon

```bash
portta host serve
```

It runs in the foreground and stops with Ctrl-C. `portta host serve --detach`
starts it in the background instead, logging to `state/host/daemon.log`. The
first start creates a
token at `state/host/token` in the installation directory, readable only by
you. Every request except `GET /api/health` must carry that token, and the
panel is the only thing that should.

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_HOST_BIND` | `127.0.0.1` | Address the daemon listens on |
| `PORTTA_HOST_PORT` | `5111` | Port the daemon listens on |

Set them in `.env`; `portta host serve` reads the installation's `.env` like
every other command.

## Keep it running

To start the daemon at login and restart it when it fails, install it as a user
service:

```bash
portta host service install
portta host service status
portta host service logs
```

The service is `portta-host`: a systemd user unit on Linux
(`~/.config/systemd/user/portta-host.service`) and a launchd agent on macOS
(`com.portta.host`, logging to `~/Library/Logs/portta-host.log`). It runs
`portta host serve` from this installation, so it reads the same `.env`; after
changing that file, run `portta host service restart`. `--env KEY=VALUE`
writes an extra variable into the unit, and `LINEAR_API_KEY` is carried from the
installing shell unless `--no-auto-env` is given. `uninstall` removes it.

## Let the panel reach it

Nothing to configure: whenever the panel is on, it is wired to the daemon. The
panel container gets the name `host.docker.internal` for the host, the daemon's
token mounted read-only, and `PORTTA_HOST_URL`, which defaults to
`http://host.docker.internal` on `PORTTA_HOST_PORT`. `portta up` and
`portta web up` create the token before the panel starts, so the order in which
you start the daemon and the panel does not matter.

The Taskflow module is part of the panel, the CLI (`portta flow`) and the
daemon, so the same wiring carries its pages and routes; there is nothing to
enable. See [Taskflow](../../modules/taskflow/README.md).

The panel never receives a project directory or the daemon's own state. Each
request it forwards is checked against a Portta permission first; a request for
a route the module does not declare is refused without reaching the host.

## Docker Desktop and Linux

On **Docker Desktop** (macOS and Windows), `host.docker.internal` reaches the
host's loopback, so the default `PORTTA_HOST_BIND=127.0.0.1` works.

On **Linux**, `host.docker.internal` is the Docker bridge gateway, and a daemon
bound to loopback is not reachable from a container. Bind it to the bridge
address instead:

```bash
ip -4 addr show docker0        # usually 172.17.0.1
```

```bash
PORTTA_HOST_BIND=172.17.0.1
```

Never bind the daemon to `0.0.0.0`. The token is the only credential between
the network and a process that can run commands on the host. A firewall that
blocks the port from anything but the bridge is a sensible second layer.

## Check it

```bash
curl -s http://127.0.0.1:5111/api/health          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:5111/api/modules/anything      # 401 without the token
```

When the panel cannot reach the daemon, issue routes answer `503` and module
pages answer `502`, each with a hint; when the token or `PORTTA_HOST_URL` is
missing they answer `503`.
