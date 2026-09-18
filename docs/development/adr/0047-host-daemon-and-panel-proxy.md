# 0047. A host daemon does the host's work, and the panel reaches it through a proxy

**Status:** Accepted; see [0001](0001-decoupled-infrastructure.md), [0030](0030-the-panel-and-a-project-lifecycle.md)

## Context

The panel runs in a container without git, tmux, agent CLIs or any project
directory, and ADRs [0001](0001-decoupled-infrastructure.md),
[0008](0008-web-panel-socket-proxy.md) and [0010](0010-git-collected-on-the-host.md)
keep it that way on purpose. Taskflow's work cannot happen there: it creates
worktrees, keeps terminal sessions and runs agents, all against the host.

Portta already does host work outside the panel — `portta host watch` collects
metrics and `portta repos scan` collects Git — but those write files the panel
reads. Taskflow needs requests and live streams in both directions.

## Decision

**Work that needs the host runs in `portta host serve`, a long-running process
on the host. The panel operates it through an authorised proxy, and never gains
the host's capabilities itself.**

The daemon (`packages/host`, `portta-host`):

- is bundled with the CLI as `dist/host.js` and started by `portta host serve`
  as a child process, so the same program can run in the foreground, detached
  or under a service manager;
- serves only `GET /api/health` without a credential; every other route and
  every socket needs `Authorization: Bearer` with the token in
  `$PORTTA_HOME/state/host/token`, created once with mode `0600` and compared in
  constant time;
- mounts host modules at `/api/modules/<id>` and `/ws/modules/<id>/`, and holds
  no user, role or permission of its own;
- binds `127.0.0.1:5111` by default (`PORTTA_HOST_BIND`, `PORTTA_HOST_PORT`). On
  Linux, where a container reaches the host at the bridge gateway, it binds that
  address. It is never bound to every interface by default.

The panel:

- gets the daemon whenever the panel is on, through
  `docker/compose/features/panel-host.yaml`: `host.docker.internal`, the token
  mounted read-only, and `PORTTA_HOST_URL`. No project directory, socket or
  daemon state is mounted;
- forwards with `createHostProxy`, which accepts only the routes named in a table
  of method, pattern and Portta permission. An unnamed route is a 404 that never
  reaches the host; a named route is authorised against the principal, with its
  Project scope when it has one, before a byte is sent;
- strips the caller's cookies, authorization and `x-portta-*` headers, adds the
  token and attribution from the resolved principal, drops `set-cookie` from
  responses, and streams bodies both ways so uploads and server-sent events pass
  through;
- bridges sockets with `createHostWsRoute`, a `WsRoute` authorised before the
  handshake by the panel's upgrade handler, like every other socket
  ([ADR 0043](0043-container-console-over-docker-exec.md)).

## Ownership, unchanged

ADR 0001's ownership claim stands: Portta does not own a project, its
directories, its volumes or its lifecycle. ADR 0030's line stands too: Portta
may *operate* on request, and a module operating worktrees or terminals on the
operator's behalf is that same claim. What this record adds is where such an
operation may run — a host process the operator started, beside the runner
container — and that the panel may reach one host process other than Docker,
through a token and a permission table.

## Consequences

- Authorisation has one implementation. The daemon trusts the token; the panel
  decides who may use it.
- Whoever can read `state/host/token` can drive the daemon. The token is as
  sensitive as the operator's shell and is treated that way: never in `.env`,
  never in a response, never in a log.
- The Linux bridge binding is an operator step and is documented rather than
  automated; loopback is enough on Docker Desktop.
- A second transport — the panel's routes plus the daemon's — is a second place
  a route can be forgotten. The permission table is the review surface for it.
- A module whose routes are about a Project names it its own way; Taskflow uses a
  URL prefix and a host directory. Its table scopes such a route to the Portta
  Project whose directory or repository path is that directory, and a directory
  no Project claims to `{ projectId: null }`, reachable only by somebody who sees
  every Project (`packages/server/src/modules/taskflow/scope.ts`).

## Note

As implemented with Taskflow: `portta host serve --detach` is the detached
start, and `portta host service install` is the service-manager path, one user
service per machine named `portta-host` (launchd label `com.portta.host`) that
runs `portta host serve` from the installation. `PORTTA_HOST_STATE_DIR`
overrides the state directory. The same token also authenticates the local
callers that reach the daemon without the panel: `portta flow`, `portta doctor`,
and agent hooks reporting runtime events. There is no second token for a
non-loopback bind.
