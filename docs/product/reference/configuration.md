# Configuration reference

Look up the installation variables, defaults and their meaning. The installation `.env` stores values; `.env.example` defines supported variables. Use `portta inspect` to inspect resolved configuration without printing secrets.

## Common

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_PROFILE` | `local` | Default profile for `up` |
| `PORTTA_PROJECT_NAME` | `portta` | Compose project name of the gateway itself |
| `PORTTA_NETWORK` | `portta` | Shared external network |
| `PORTTA_CONTROL_NETWORK` | `portta-control` | Internal Traefik ↔ socket proxy network |
| `PORTTA_ACCESS_NETWORK` | `portta-access` | Network for persistent TCP forwarders |
| `PORTTA_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `PORTTA_ACCESS_LOG` | `false` | Traefik access logs, useful when a route misbehaves |

`PORTTA_PROJECT_NAME` is load-bearing: ownership checks use it to tell
gateway containers from everything else. Changing it orphans the running stack.

## Local profile

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_DOMAIN_MODE` | `local` | `local` (`*.localhost`), `auto` (derived from `PORTTA_PUBLIC_IP` through sslip.io/nip.io) or `custom` (`PORTTA_DOMAIN` as typed). Switch with `portta config set domain.mode` |
| `PORTTA_PUBLIC_IP` | detected | Used by `auto`; `setup` detects it, `portta config set domain.mode auto` refreshes it |
| `PORTTA_AUTO_DOMAIN_PROVIDER` | `sslip.io` | `sslip.io` or `nip.io`, read only when the mode is `auto` |
| `PORTTA_DOMAIN` | `localhost` | Base domain for generated hostnames; read when the mode is `custom`, overwritten by the other two |
| `PORTTA_BIND_ADDRESS` | `127.0.0.1` | Host interface Traefik publishes on |
| `PORTTA_HTTP_PORT` | `80` | Host port for HTTP |
| `PORTTA_HTTPS_PORT` | `443` | Host port for HTTPS |

`PORTTA_BIND_ADDRESS` is the single most security-relevant setting here.
Loopback keeps the gateway invisible to everyone else on your network;
`doctor` fails if the local profile is bound to every interface (`0.0.0.0`).
Binding one LAN or tailnet address on purpose is covered in
[Open a project from another device](../guides/local-development.md#open-a-project-from-another-device).

If 80 is already taken, changing `PORTTA_HTTP_PORT` to, say, `8080` means
URLs become `http://demo-shop-web.localhost:8080`.

## Header aliasing

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_ALIAS_HEADERS_STRATEGY` | `keep` | `keep`, `delete` or `reject` |

Headers whose names contain characters outside `[A-Za-z0-9-]` can alias a
canonical header once a backend normalises them (`X_Auth_User` becoming
`X-Auth-User` in CGI, WSGI, PHP or nginx), which lets a client spoof headers
Traefik manages.

`keep` is Traefik's default and is fine behind loopback or a VPN. `delete`
strips them, but also strips *legitimate* underscore headers, which can break
an app in a confusing way, so it is opt-in locally and applied automatically
by the public profile.

## Dashboard

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_DASHBOARD` | `false` | Enable Traefik's dashboard |
| `PORTTA_DASHBOARD_BIND_ADDRESS` | `127.0.0.1` | Interface for the dashboard port |
| `PORTTA_DASHBOARD_PORT` | `8080` | Host port |

The loopback path exposes your full routing table on its own port, never
through `web`/`websecure`, so it can never appear under the public wildcard
domain. `doctor` still fails if that port is bound anywhere but loopback.

The dashboard is always loopback-only. It has no routed access mode.

## Databases by hostname

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_TCP` | `false` | Publish one entrypoint per protocol and route on the hostname |
| `PORTTA_TCP_POSTGRES_PORT` | `5432` | Host port for the PostgreSQL entrypoint |
| `PORTTA_TCP_REDIS_PORT` | `6379` | Host port for the Redis entrypoint |

Off by default, and opt-in twice: the gateway publishes the entrypoints, and a
project's datastore has to carry the router labels before anything routes to
it. Refused on the `remote-public` profile. TLS is required, because the
hostname travels in the TLS handshake. PostgreSQL and Redis work; MySQL cannot.
See [Configure TCP routing](../guides/tcp-routing.md).

## Web panel

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_WEB` | `false` | Start the administration panel with the gateway |
| `PORTTA_WEB_BIND_ADDRESS` | `127.0.0.1` | Interface the panel is published on |
| `PORTTA_WEB_PORT` | `8081` | Host port |
| `PORTTA_WEB_EXPOSE` | `local` | Panel access: `local` (loopback), `tailscale` (the tailnet address), `vpn` (routed at `PORTTA_WEB_HOST.<domain>` on `remote-private`), `public` (Traefik's `panel` entrypoint on every interface) or `domain` (routed on one hostname of the gateway's domain) |
| `PORTTA_PANEL_ADVERTISED_HOST` | derived | The hostname `domain` routes on, and the address a human types |
| `PORTTA_WEB_HOST` | `portta-web` | Hostname label used by `vpn` |
| `PORTTA_WEB_READ_ONLY` | `false` | Refuse every mutating endpoint, whoever signed in. `portta web up --expose vpn` sets it unless `--writable` is given; `--read-only` sets it for any access mode |
| `PORTTA_AUTH_MODE` | `disabled` | `disabled` answers everybody as the local operator, and is accepted with panel access `local`, `tailscale` or `vpn`; `required` makes people sign in, and is the only value `domain` and `public` accept |
| `PORTTA_AUTH_ALLOW_LAN` | `false` | Accept that every device on this network is the local operator. Needed only for access `local` bound to something other than loopback, where the panel otherwise refuses to start |
| `PORTTA_PANEL_URL` | `http://127.0.0.1:<port>` | The origin a browser reaches the panel on. Decides where sign-in redirects to and whether the session cookie may be `Secure` |
| `PORTTA_PANEL_TRUSTED_ORIGINS` | empty | Other origins a browser may sign in from, comma-separated. Loopback and the panel URL are always trusted |
| `PORTTA_AUTH_SIGNIN_ATTEMPTS` | `5` | Sign-in attempts one address gets every ten minutes. 3–100; anything else reads as the default |
| `PORTTA_WEB_DEV` | `false` | Development mode: bind-mounted panel and ForwardAuth sources reload on change; the dev image only supplies dependencies |
| `PORTTA_WEB_IMAGE` | pinned release | The panel image. A normal installation pulls it; only useful to override outside a checkout |
| `PORTTA_WEB_BUILD` | `false` | Build the panel image from this checkout instead of pulling it. Only useful inside the repository, whose root is the build context |
| `PORTTA_WEB_NETWORK` | `portta-web` | The panel's own internal control network |
| `PORTTA_WEB_USER` | `node` in the image; setup records `$(id -u):$(id -g)` when the key is empty | User the panel container runs as, so Settings can save `.env` |
| `PORTTA_AUTH_USER` | same as `PORTTA_WEB_USER` | User the ForwardAuth service runs as; same reason |
| `PORTTA_APPLY` | `true` in `.env.example` | Prepare the applier the panel may start to run `portta up` ([ADR 0026](../../development/adr/0026-applying-settings-from-the-panel.md)). Set `false` on a host where the panel is reachable by anyone you would not give a shell |
| `PORTTA_RUNNER` | `true` in `.env.example` | Prepare the project runner the panel may start to drive Compose for one project ([ADR 0030](../../development/adr/0030-the-panel-and-a-project-lifecycle.md)) |
| `PORTTA_PROJECTS_HOME` | `~/projects` (`/srv/projects` as root) | Projects Home, the directory managed Projects live under. `portta repos scan` reads it on the host, and development/demo commands discover `portta-demo-*` repositories there. The panel only receives the path as a string to classify locations, and never mounts it ([ADR 0031](../../development/adr/0031-projects-home-and-project.md), [ADR 0044](../../development/adr/0044-example-projects-live-in-projects-home.md)) |
| `PORTTA_RUNTIME_DATABASE_FILE` | `/app/state/panel/portta.db` | The panel's SQLite file, inside the container. Compose sets it over a bind mount of `$PORTTA_HOME/state/panel`; the CLI resolves the host path from `$PORTTA_HOME` instead, and neither derives the other's ([ADR 0037](../../development/adr/0037-sqlite-is-the-panel-database.md)) |
| `PORTTA_AUTH_SECRET` | generated | **Secret.** Signs the panel's sessions and tokens, and the ForwardAuth process's host-scoped cookies. Rotating it signs everybody out of both |
| `PORTTA_AUTH_IMAGE` | Portta release image | Image running the isolated auth process |
| `PORTTA_RUNTIME_DOCS` | `true` | Serve this documentation at `/docs`, from the panel image. Static text with no host information in it, so a routed panel may serve it |
| `PORTTA_RUNTIME_API_DOCS` | empty | Serve the API reference and its console at `/docs/api`. Empty means the safe default: on for loopback, off when routed |
| `PORTTA_MCP_HTTP` | `false` | Serve the MCP tools over Streamable HTTP at `POST /api/mcp`, for an agent that has no CLI where it runs. The same tools as `portta mcp`, behind the same credential and the same agent ceiling; reachable from wherever the panel is ([MCP reference](mcp.md#reach-it-over-http), [ADR 0054](../../development/adr/0054-mcp-tools-are-shared-and-served-over-http.md)) |
| `PORTTA_RUNTIME_TRAEFIK_API` | derived from the attachment | Override for the Traefik API endpoint behind the panel's bounded write surface ([ADR 0011](../../development/adr/0011-bounded-traefik-write-surface.md)) |

The panel binds loopback by default. `PORTTA_AUTH_MODE=disabled` is accepted
where the reachable set is already an authenticated set — access `local`,
`tailscale` or `vpn` — and refused at boot under `domain` and `public`, which
answer whoever finds the address. The one case the access mode does not settle
is `local` bound to something other than loopback, and that needs
`PORTTA_AUTH_ALLOW_LAN=true` or the panel refuses to start
([ADR 0051](../../development/adr/0051-authentication-is-optional-inside-a-trusted-network.md)).
`vpn` is refused on the `remote-public` profile. On a Linux host set
`PORTTA_WEB_USER` to `$(id -u):$(id -g)` if you want the Settings page to be
able to write `.env`.

`portta web up` sets these for you and generates the signing secret without
printing it. The panel's database is one file it opens in its own process, with
no server, no port and no credential; it is a boot dependency all the same,
because the panel remembers everything there, including who its users are. See
[Use the web panel](../guides/web-ui.md),
[Configure authentication](../guides/authentication.md) and
[Persistence](../concepts/persistence.md).

## TLS

| Variable | Default | Meaning |
|---|---|---|
| `TLS_ENABLED` | `false` | Master switch for HTTPS |
| `TLS_MODE` | `local` | `local` (local CA) or `acme` (Let's Encrypt) |
| `ACME_EMAIL` | — | Required when `TLS_MODE=acme` |
| `ACME_CA_SERVER` | production LE | Point at staging while testing |
| `ACME_CHALLENGE` | `dns` | `dns` (one wildcard, needs a credential) or `http` (one per hostname, needs `:80`) |
| `ACME_DNS_PROVIDER` | `cloudflare` | lego provider name for DNS-01 |
| `ACME_DNS_RESOLVERS` | `1.1.1.1:53,8.8.8.8:53` | Propagation checks |

Wildcard certificates require DNS-01; HTTP-01 cannot issue them, which is why
`dns` is the default. A public gateway that would rather not hold a DNS
credential can set `ACME_CHALLENGE=http` and get a certificate per hostname
instead — see [DNS and TLS](../guides/dns-and-tls.md). Use `ACME_CA_SERVER` with the
staging endpoint while you get either working, because Let's Encrypt rate
limits are unforgiving.

## Private access

| Variable | Default | Meaning |
|---|---|---|
| `TAILSCALE_ENABLED` | `false` | Run the Tailscale component |
| `TAILSCALE_HOSTNAME` | `portta` | Node name on the tailnet |
| `TS_AUTHKEY` | — | **Secret.** Prefer an ephemeral, tagged, pre-authorized key |
| `TS_EXTRA_ARGS` | — | Extra flags for `tailscale up` |
| `PRIVATE_DOMAIN` | — | Wildcard namespace served over the VPN |

## Public access

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_ENABLED` | `false` | Opt in to internet exposure |
| `PUBLIC_DOMAIN` | — | Public wildcard, e.g. `dev.example.com` |

Off by default and deliberately awkward to turn on. `portta public enable`
prints exactly what will become reachable and asks for confirmation.

## Cloudflare

| Variable | Default | Meaning |
|---|---|---|
| `CLOUDFLARE_ENABLED` | `false` | Use Cloudflare for DNS-01 |
| `CF_DNS_API_TOKEN` | — | **Secret.** Scoped API Token |
| `CLOUDFLARE_ZONE` | — | Target zone |

Use a scoped token with `Zone:DNS:Edit` on the one zone. Never the Global API
Key, which authenticates everything in the account and cannot be scoped.

## Cloudflare Tunnel

| Variable | Default | Meaning |
|---|---|---|
| `CLOUDFLARE_TUNNEL_ENABLED` | `false` | Run the `cloudflared` connector |
| `CLOUDFLARE_TUNNEL_ZONE` | — | The domain whose wildcard points at the tunnel |
| `CLOUDFLARE_TUNNEL_ID` | — | The named tunnel's id, written by `portta tunnel setup` |
| `PORTTA_CLOUDFLARED_IMAGE` | pinned `cloudflare/cloudflared` | The connector image |

The tunnel credential and configuration live under `state/cloudflared/`, never
in `.env`. See [Cloudflare Tunnel](../guides/cloudflare-tunnel.md) and
[ADR 0025](../../development/adr/0025-cloudflare-tunnel.md).

## Issues

There is nothing here for GitHub. The panel holds no forge credential: it asks
the host daemon, and the daemon runs the operator's own `gh`, which carries its
own authentication ([ADR 0018](../../development/adr/0018-github-issues-through-the-gh-cli.md)).
Signing in is `gh auth login` on the host, not a variable.

| Variable | Default | Meaning |
|---|---|---|
| `LINEAR_API_KEY` | — | **Secret.** Read by the host daemon, not by the panel. Set it in the environment `portta host serve` runs with; without it Linear reports itself unauthenticated and the panel says so |

Which provider a Project uses is a property of the Project, not of the
installation: a repository with a GitHub remote is enough, and Linear is chosen
on the Project along with its team key. See
[Connect GitHub](../guides/github.md) and [Work with issues](../guides/issues.md).

## Host daemon

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_HOST_BIND` | `127.0.0.1` | Where `portta host serve` listens. On Linux, the Docker bridge gateway (for example `172.17.0.1`); never `0.0.0.0` |
| `PORTTA_HOST_PORT` | `5111` | The daemon's port |
| `PORTTA_HOST_STATE_DIR` | `state/host` in the installation | The daemon's state directory: its token and each module's state |
| `PORTTA_HOST_URL` | `http://host.docker.internal:<PORTTA_HOST_PORT>` | Where the panel reaches the daemon |

Whenever the panel is on, it is wired to the daemon: `host.docker.internal`
mapped to the host gateway, `PORTTA_HOST_URL`, and the token mounted read-only.
The token lives at `state/host/token`, `0600`, and is never written to `.env`.
Issues need the daemon; without it, issue views say the provider could not be
reached. See [Run the host daemon](../guides/host-daemon.md).

## Secrets

`.env` is git-ignored, `bootstrap` writes it `0600`, `inspect` prints `<set>`
rather than values, and lint fails on tracked auth keys or private keys. Gateway
state, including ACME material, lives under `state/`, which is also ignored.

## Host metrics

`portta host collect` writes `state/metrics/current.json` on the host. The
panel only reads that file — it cannot see the real machine from inside its
container, and it never calls `systeminformation`. `portta up` and
`portta web up` start a detached watcher that refreshes the snapshot every
five seconds. See [Host metrics](host-metrics.md).

There is no operator setting for collection. The panel's
`PORTTA_RUNTIME_METRICS_DIR` is the mount path inside the container
(default `/app/state/metrics`); it is not in `.env.example`.

Host tool readiness follows the same boundary. The CLI writes
`state/environment/report.json`; the panel mounts it read-only at
`/app/state/environment`. See [Host environment readiness](host-readiness.md).

## Configuration ownership

The installation `.env` is the source of shared configuration and credentials.
`.env.example` defines its structure, groups, comments and supported variables.
`portta config prepare` creates or reconciles it without starting services;
`setup`, `bootstrap`, `up` and `web up` also prepare it.

Persisted `.env` values **win over the inherited shell environment**. Explicit
configuration commands write the file before resolving Compose. Runtime selectors
such as `PORTTA_ROOT` and `PATH` are process inputs, not
installation settings. Internal service ports and filesystem paths in containers
are architectural constants. `PORTTA_VERSION` derives from the generated
runtime version packaged with the installed CLI.

Preparation fills absent keys from the template and generates absent/empty secrets
once. It keeps configured values, including deliberate empty optional fields.
Missing keys are inserted near their template neighbours. Ordinary edits
only replace the requested values, preserving comments, order, spacing and line
endings. Duplicate keys are rejected. Dotenv content is parsed, never executed;
Portta treats values literally rather than evaluating `${OTHER_VARIABLE}`.

CLI and panel share `portta-core`'s document editor. A `.env-lock/writer` directory serializes
writes across the host and panel; `.env-lock` is a shared mount, not image content.
Backups and in-place writes preserve the file's inode and mode `0600`. A stale
lock fails with a diagnostic; only remove it after verifying no writer is active.

How those values relate — project hostnames, public access, the panel URL,
Traefik, TLS, VPN and DNS — is [Addresses and access](../concepts/addresses-and-access.md).
The Settings pages edit the same keys without asking you to think in variable
names.

```bash
portta inspect     # what the CLI actually resolved (secrets shown as <set>)
```
