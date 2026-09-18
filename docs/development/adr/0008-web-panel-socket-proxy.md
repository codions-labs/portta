# 0008. The web panel gets its own Docker socket proxy

**Status:** Accepted; see [0043](0043-container-console-over-docker-exec.md)

## Context

The panel exists to make a busy Docker host legible: which projects the gateway
routes, what else is running beside them, which port is already taken, and
where a database can be reached. Some of that is inherently write access:
restarting a service, stopping a container somebody forgot, removing one, and
opening a TCP bridge.

Traefik's socket proxy ([ADR 0002](0002-docker-socket-proxy.md)) is read-only,
deliberately: `POST: "0"` and every write flag off. Its permission set is a
promise, and it is one of the few things in this repository that would be
genuinely dangerous to loosen. Extending it so that the panel can restart a
container would extend it for Traefik too, and Traefik is the component with
the largest attack surface in the stack.

## Decision

The panel gets a **second** socket proxy of its own, on its own `internal`
network, reachable from nothing but the panel.

It grants the read endpoints the panel needs (containers, networks, events,
info, version, ping), the container lifecycle (`POST`, with `ALLOW_START`,
`ALLOW_STOP`, `ALLOW_RESTARTS`) and the `EXEC` category, which the container
console needs ([ADR 0043](0043-container-console-over-docker-exec.md)). Images,
volumes, build, swarm, secrets, plugins and the system endpoints stay denied.

Traefik's proxy is untouched, and stays read-only.

Because `tecnativa/docker-socket-proxy` gates by path prefix and HTTP method,
`CONTAINERS: "1"` together with `POST: "1"` is broader than what the panel
needs: it would also forward `POST /containers/prune` and every exec path. So
the panel enforces a second, narrower layer in its own process: a hard
allowlist of (method, path) pairs in
`packages/server/src/services/docker/allowlist.ts`, checked before any request
is emitted. A call not on that list never reaches the proxy.

The two layers together are what the panel is allowed to do:

| Operation | Proxy | Panel allowlist |
|---|---|---|
| List, inspect, logs, events, info | allowed | allowed |
| Start, stop, restart a container | allowed | allowed |
| Remove a container | allowed | allowed, always with `v=0&link=0` |
| Create a container | allowed | one shape only: the socat TCP bridge |
| `exec` (create, start, resize, inspect) | allowed (`EXEC: "1"`) | four paths only, for the console ([ADR 0043](0043-container-console-over-docker-exec.md)) |
| `prune`, `archive`, `attach` | partly reachable | **denied** |
| Images, volumes, build, swarm, secrets | denied | denied |

`exec` deserves a note: the proxy forwards every exec path, so the allowlist is
what keeps the surface at the four the console uses. A user, a command or a
privileged flag never appears in one of those requests, because the server
builds them itself.

## Consequences

There is one more container in the stack when the panel is enabled, and one
more place where socket permissions are declared. Both are worth it: the two
permission sets have different justifications and different blast radii, and
merging them would mean the stricter one is only as strict as the looser one.

`packages/server/tests/allowlist.test.ts` asserts the allowlist in both
directions, so a future edit that adds a rule for `/images`, `/volumes` or an
exec path outside the four fails the build.

The panel needs no Docker socket and no Docker CLI. What it gets from the host
filesystem is listed in `docker/compose/features/web.yaml` and nothing else:
`.env`, which its Settings page edits; `state/git` and `state/metrics`,
read-only, written by the host collectors; `state/panel`, its own SQLite
database; `state/ssh`, the credentials it manages; and the host daemon's token,
read-only, when the daemon is enabled. It cannot pull an image, so
`portta web up` pulls the bridge image on the host, where the CLI already has
real Docker access.

Applying settings needs Compose on the host, so the host prepares a container
to run it and the panel only *starts* it
([ADR 0026](0026-applying-settings-from-the-panel.md)), with the `start` it
already holds. A change that grants the panel `IMAGES`, `VOLUMES`, or a
request shape it does not build itself is the thing this ADR exists to
prevent, and needs an ADR of its own.
