# 0043. Container consoles use Docker exec through the panel proxy

**Status:** Accepted; see [0008](0008-web-panel-socket-proxy.md)

## Context

Inspecting and operating a project container does not complete an interactive
diagnosis; a shell does. Docker exec is more privileged than a lifecycle
operation: it can read the process environment, mounted files and application
configuration, which is why [ADR 0008](0008-web-panel-socket-proxy.md) keeps
it behind both the proxy and the application allowlist.

## Spike result

An isolated spike used `tecnativa/docker-socket-proxy:v0.5.0`, an Alpine target
and a Node 24 client on a private Docker network. With `CONTAINERS=1`, `EXEC=1`
and `POST=1`, the proxy returned `201` for exec creation, forwarded the HTTP
hijack with `101`, carried an interactive marker in both directions, returned
`200` for resize and exposed `Running` through inspect.

Destroying the hijacked socket did **not** stop the exec. A second exec could
not kill the `Pid` reported by inspect because it is in the daemon's host PID
namespace. Keeping the hijack open, sending terminal `Ctrl-C` followed by
`exit`, and then inspecting did stop it (`Running: false`). All spike containers
and its network were removed after the measurement.

## Decision

The panel proxy enables the `EXEC` category. The application allowlist admits
exactly four paths: create, attach/start, resize and inspect. Traefik's proxy is
unchanged. The client retains its handwritten, typed API; there is no generic
Docker request.

`container:console` is a separate permission held by owner and administrator,
not developer, viewer or the default local agent. A console is resolved from an
environment and service already visible to the panel, must be running and may
not be a Portta-owned component. The server chooses `/bin/bash` then `/bin/sh`,
never accepts a user, command or privileged flag, and reports a shell-less
image explicitly.

The browser and Docker streams remain separate. Browser binary frames carry TTY
bytes; JSON text frames carry bounded resize messages. The session idles out
after 15 minutes and ends after two hours. On every close path the server keeps
the Docker stream, sends interrupt plus `exit`, verifies inspect, tries terminal
quit plus `exit` if needed, then releases the stream. The closing audit entry
records whether Docker confirmed teardown. Keystrokes and terminal output are
never audited.

The terminal emulator is dynamically imported only after an authorised
operator opens the console.

## Consequences

The panel becomes a stronger target: an administrator may read any secret the
selected project container can read. This is why the grant is narrower than
`container:operate`, the action is hidden without permission and public panel
access still requires authentication.

Docker has no exec-kill endpoint. The verified TTY teardown works for the fixed
interactive shells, while a hostile program that changes terminal signal
handling can delay exit. A false `teardownConfirmed` audit value is an explicit
operational finding; silently claiming the session ended is not acceptable.
