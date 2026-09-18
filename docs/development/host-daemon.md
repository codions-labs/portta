# Host daemon and module proxy

How a module whose work needs the host is served, and how the panel reaches it.
The operator side is [Run the host daemon](../product/guides/host-daemon.md);
the module registries are described in [Monorepo layout](monorepo.md#official-modules).

## Shape

```text
Browser ── /api/modules/<id>/* ─┐        ┌── /ws/modules/<id>/* ── Browser
                                ▼        ▼
            Panel (container): principal, origin guard, permission table
                                │  Authorization: Bearer <state/host/token>
                                │  x-portta-actor, x-portta-user-id (attribution only)
                                ▼
            portta host serve (host): token check, module routes and sockets
                                │
                     git, tmux, agent CLIs, project directories
```

Three pieces, each generic:

| Piece | Where | What it does |
|---|---|---|
| Host daemon | `packages/host` (`portta-host`) | `createHostApp` mounts each enabled host module at `/api/modules/<id>` behind a constant-time Bearer check; `GET /api/health` is the one public route. `startHost` adds one upgrade listener for `/ws/modules/<id>/…`, authenticated before the handshake |
| HTTP proxy | `packages/server/src/modules/proxy.ts` | `createHostProxy({ moduleId, routes, config })` forwards only the routes named in a table of `{ method, pattern, permission, scopeOf? }`. Anything else is a 404 without a request to the host |
| WebSocket bridge | same file | `createHostWsRoute(...)` is a `WsRoute`: the panel's upgrade handler authorises it, then frames are piped to the same path on the host with the token |

## What the proxy guarantees

- **Authorisation stays in the panel.** The principal must hold the route's
  permission, in the route's Project scope when `scopeOf` names one. Read-only
  mode and the same-origin guard apply, because the proxy is mounted inside
  `createApi`.
- **The caller's credentials never reach the host.** `cookie`, `authorization`,
  hop-by-hop headers and any incoming `x-portta-*` are dropped; the token and
  the attribution headers are added from the resolved principal.
- **The host cannot set panel state.** `set-cookie` is dropped from responses.
- **Bodies stream.** Request bodies are forwarded as streams (`duplex: 'half'`),
  and response bodies are returned as streams, so server-sent events arrive as
  the daemon writes them and uploads are not buffered.
- **Failures are named.** No `PORTTA_HOST_URL` or an unreadable token is `503`;
  a daemon that does not answer is `502`.

## Declaring a module's routes

A server module mounts the proxy as its routes, and a host module serves the
same paths:

```ts
// packages/server/src/modules/<id>/index.ts
export const serverModule: ServerModule = {
  manifest,
  routes: (deps) => createHostProxy({ moduleId: manifest.id, routes: ROUTES, config: deps.config }),
  ws: (deps) => [createHostWsRoute({ moduleId: manifest.id, path: '/runs/:id/terminal', permission: 'run:operate', config: deps.config })],
}
```

Patterns use `matchPath` from `portta-core`: `:name` segments and a trailing
`*`. The table is the review surface for what the browser may ask the host, so
keep one entry per route rather than a wildcard over a whole module.

## Running it in development

```bash
npm run build --workspace=@codions/portta   # bundles dist/cli.js, dist/host.js, dist/supervisor.js and dist/assets
PORTTA_HOST_PORT=5111 ./bin/portta host serve
```

`portta host serve` starts `dist/host.js` as a child process with the
installation's environment, `PORTTA_ROOT` and `PORTTA_HOST_STATE_DIR`, and
passes termination signals on. The daemon never runs inside the CLI process, so
the same program runs detached (`portta host serve --detach`) and under a
service manager (`portta host service install`, which writes a unit running
`portta host serve`). `npm run dev:taskflow --workspace portta-host` runs it
from source; see the module's
[development page](../modules/taskflow/development.md).

The panel side needs nothing extra: whenever the panel is on,
`docker/compose/features/panel-host.yaml` adds `host.docker.internal`, the
read-only token mount and `PORTTA_HOST_URL`. `just dev` includes it, so issue
views and Taskflow's pages in a checkout panel work as soon as the daemon runs
(`./bin/portta host serve --detach`).

The bind address is the one platform difference. Docker Desktop forwards
`host.docker.internal` to the host's loopback, so `127.0.0.1` works there. On
Linux `host-gateway` resolves to the bridge gateway, so the daemon must bind
that address (`PORTTA_HOST_BIND=172.17.0.1` for the default bridge). The Linux
path is documented, not covered by the automated suites.

## Tests

- `packages/host/tests/app.test.ts`: health is public, every other route and
  socket needs the token, modules mount under their prefix, the token file is
  created `0600` and never replaced.
- `packages/server/tests/modules-proxy.test.ts`: a fake host proves the
  forwarding (token, attribution, stripped credentials), request streaming,
  SSE passthrough, permission and table refusals, `502`/`503`, and a WebSocket
  echo through the bridge.
