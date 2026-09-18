# 0019. The compose files live under `docker/compose/`, one directory per axis

**Status:** Accepted; see [0044](0044-example-projects-live-in-projects-home.md)

## Context

The gateway is not one Compose file. It is a base plus a set of overlays that
each contribute only the keys they change, per
[ADR 0003](0003-traefik-static-config-via-env.md). By the time the panel, TCP
routing, the tunnel and the Tailscale attachment exist, that is more than
twenty files, and a flat listing gives no hint of the structure behind them:
nothing in it says that exactly one attachment is always selected, or that
`dashboard.yaml` and `dashboard-tailscale.yaml` are two answers to one
question and never both.

The structure is not flat. Each file is chosen by a distinct condition in
`composeFiles` (`packages/core/src/config.ts`), and the conditions form a
matrix with one axis per decision:

| Axis | Files | Selected by |
|---|---|---|
| Base | `compose.yaml` | always |
| Attachment | `attach/{host,tailscale}.yaml` | exactly one, always |
| Profile | `profiles/{local,local-tls,remote,remote-tls,remote-tls-dns,remote-tls-http,public}.yaml` | the profile, plus TLS mode |
| Dashboard | `features/dashboard{,-tailscale}.yaml` | `PORTTA_DASHBOARD` and the attachment |
| TCP | `features/tcp{,-tailscale}.yaml` | `PORTTA_TCP` |
| Panel | `features/web.yaml` and `panel-host.yaml`, then `web-{bind,build,dev,vpn}.yaml`, `panel-{domain,public}.yaml`, `auth-{build,dev}.yaml` | `PORTTA_WEB`, the panel access mode and the build mode |
| Tunnel | `features/cloudflare-tunnel.yaml` | the tunnel provider ([ADR 0025](0025-cloudflare-tunnel.md)) |

### Why the pairs are not consolidated

The obvious reading is that `dashboard.yaml` and `dashboard-tailscale.yaml` are
duplication waiting to be merged behind a Compose `profiles:` key. They are not.
Compose profiles gate **whole services**, not fragments of one. What differs
between the pair is which already-existing service carries the `ports:` entry:
`traefik` owns its network namespace under the host attachment, and owns nothing
under the Tailscale one, where `tailscale` publishes on its behalf
([ADR 0007](0007-tailscale-sidecar.md)). The same holds for the TCP pair. There
is no Compose construct that expresses "put this port on a different service
depending on an earlier overlay", so the pair is the mechanism, not an accident.

### Relative paths resolve against the project directory

The overlays carry relative bind mounts (`./config/traefik/dynamic`,
`./state/traefik/acme`, `./.env`, `./apps/web/src`, `./packages/core/src`) and
build contexts of `context: .` that must be the monorepo root, because
`apps/web/Dockerfile` copies the workspace lockfile.

Compose resolves every relative path against the **project directory**, which
defaults to the directory of the first `-f` file — not the directory of the file
the path is written in. Every invocation therefore passes
`--project-directory <root>`, which does not touch the project name;
`docker/compose/compose.yaml` declares that explicitly as
`name: ${PORTTA_PROJECT_NAME:-portta}`.

## Decision

The gateway's compose files live under `docker/compose/`, in one directory per axis:

```
docker/
└── compose/
    ├── compose.yaml
    ├── attach/     host.yaml, tailscale.yaml
    ├── profiles/   local.yaml, local-tls.yaml, remote.yaml, remote-tls.yaml,
    │               remote-tls-dns.yaml, remote-tls-http.yaml, public.yaml
    └── features/   dashboard.yaml, dashboard-tailscale.yaml, tcp.yaml,
                    tcp-tailscale.yaml, web.yaml, web-bind.yaml, web-build.yaml,
                    web-dev.yaml, web-vpn.yaml, panel-domain.yaml,
                    panel-host.yaml, panel-public.yaml, auth-build.yaml,
                    auth-dev.yaml, cloudflare-tunnel.yaml
```

The file names carry neither a `compose.` prefix nor the axis name, because
the directory carries both: the host attachment is `attach/host.yaml`.

Every invocation passes `--project-directory <repository root>`, so paths
inside the files resolve from the repository root. The canonical argument
builder is `composeArguments` in `packages/cli/src/context.ts`.

Runnable example projects are not part of this tree; they are independent
repositories in Projects Home
([ADR 0044](0044-example-projects-live-in-projects-home.md)).

## Consequences

The nested directory names state the matrix that is otherwise only readable in
`composeFiles`.

`composeFiles` in `packages/core/src/config.ts` is the single selection
implementation used by the CLI.

`packages/cli/src/context.ts` locates a gateway checkout by looking for a
Compose file under `docker/compose/`.

Invoking `docker compose -f …` by hand against these files is not a supported
interface: the base file says so in its header, and the CLI is the stable
operational contract. `just` and `./bin/portta` go through the CLI, and
consumer projects are unaffected: `compose.portta.yaml` lives in the adopted
project, not here.
