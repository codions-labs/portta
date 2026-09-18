# Security

## Threat model

The gateway is a development tool. Its job is to make it *hard to expose
something by accident*, and to keep an accident's blast radius small.

The realistic risks are, in order:

1. **Accidental exposure.** A database on `0.0.0.0`, a dashboard on a public
   interface, a "temporary" public domain nobody turned off.
2. **Docker socket access.** The API is not namespaced; reaching it means root
   on the host.
3. **Secret leakage.** Auth keys and API tokens in Git, logs, or shell history.
4. **Lateral movement.** One project's compromise reaching another's database.

## Exposure depends on the selected mode

- `providers.docker.exposedByDefault=false`. A service is routed only when it
  sets `traefik.enable=true`.
- The local profile binds Traefik to `127.0.0.1`. `doctor` **fails** if the
  local profile is bound anywhere else.
- The public profile is off, and turning it on prints what will become
  reachable and asks for confirmation.
- Databases and caches are never published and never joined to the shared
  network. `doctor` fails on a datastore published on `0.0.0.0` and warns on
  one attached to the shared network.
- The panel's own database is not a server at all: it is a SQLite file the
  panel opens in its own process, so there is no port to publish, no network to
  join and no credential to leak
  ([Persistence](persistence.md)).

## The Docker socket

Traefik never sees it. Discovery goes through
`tecnativa/docker-socket-proxy`, which mounts the socket **read-only** and
allows only `CONTAINERS`, `NETWORKS`, `EVENTS`, `PING` and `VERSION`. All
writes are denied (`POST=0`). The proxy runs `read_only: true`, publishes no
host port, and lives alone with Traefik on a network created `internal: true`.

`doctor` fails if the socket is mounted into Traefik, if the proxy's mount is
writable, if the proxy publishes a host port, or if the control network is not
internal.

**Residual risk, stated plainly.** Discovery requires
`GET /containers/{id}/json`, whose response includes container environment
variables. A compromised Traefik could therefore read secrets that consumer
projects pass as environment variables. This is inherent to Traefik's Docker
provider, not to this proxy. If that matters for a given project, pass secrets
as files or via a secrets manager rather than env vars.

See [ADR 0002](../../development/adr/0002-docker-socket-proxy.md).

## Network isolation

Each project keeps its own private network. Postgres, Redis, queues and search
stay there. Traefik has no route to those networks, and neither does any other
project.

The shared `portta` network is the one place projects meet, and only
HTTP-facing services join it. Anything on it is reachable by every other
project on the host, which is exactly why a database does not belong there.

## TCP access bridges

A bridge is a hole into a project's private network, so it is kept small and
short-lived. It binds `127.0.0.1` on a kernel-assigned port; binding anywhere
else needs an explicit `--bind` and a confirmation, and `doctor` **fails** on a
bridge bound beyond loopback.

`portta service publish --public` on a datastore is refused outright, not
warned about. Persistent forwarders join their project's network and the
gateway's access network only, never the shared HTTP network, which `doctor`
also enforces.

`access close` and `access gc` re-check the ownership label on the code path
that actually removes a container, rather than trusting the filter that found
it.

## The dashboard

Off by default. When enabled it is published on its own loopback-bound port and
attached only to Traefik's internal entrypoint, so it is never routed through
`web`/`websecure` and cannot appear under a public wildcard domain. `doctor`
fails if it is enabled on a non-loopback address.

The loopback bind constrains the host, not the shared network. Insecure mode
listens inside a namespace attached to `portta`, so while the dashboard is
enabled **any adopted project's container can reach `http://traefik:8080`** and
read the full routing configuration, including the hostnames and backends of
every other project on the host. On the Tailscale attachment the same API
answers at `http://tailscale:8080`. That is the cost of turning it on, it is
why it is off by default, and it is the same API the panel reads for a router's
status. Nothing
sensitive to a project's own users is there, but the inventory of the host is.

The dashboard has no routed access mode. `doctor` fails a non-loopback
`PORTTA_DASHBOARD_BIND_ADDRESS`.

## Databases reached by hostname

Off by default. Turning it on publishes one port per protocol; it does not
publish a database. Three things have to line up before one answers:
`PORTTA_TCP=true` on the gateway, `traefik.enable=true` plus TCP router
labels on the container, and the container on the access network. Being visible
to the gateway is not being routed.

- **Never public.** The TCP entrypoints are refused on the `remote-public`
  profile, where Traefik binds every interface. That is a refusal at profile
  resolution, not a warning, and `doctor` fails if the combination is ever
  reached another way.
- **Where they listen** follows the profile, like everything else: loopback
  locally, the tailnet address with Tailscale, an interface you named
  otherwise.
- **Not on the HTTP network.** An opted-in datastore joins
  `portta-access`. The shared network still carries no database; Compose
  validation and routing tests enforce that boundary.
- **TLS is mandatory**, since the hostname lives in the handshake. Without a
  configured certificate Traefik serves a self-signed one, which
  `sslmode=require` accepts and `verify-full` does not; `doctor` says so.

Authentication is unchanged and is still the database's own. The gateway routes
bytes and never reads a project's credentials.

## The web panel

The base gateway runs without the panel. Setup does not enable it:
`.env.example` ships `PORTTA_WEB=false`, `PORTTA_WEB_EXPOSE=local` and
`PORTTA_AUTH_MODE=disabled`, and `portta web up` turns it on. The panel can
start, stop and remove containers, so its access mode must be chosen
deliberately.

- **Network.** The local mode binds loopback. VPN routing and the dedicated public panel
  entrypoint are separate, explicit overlays; the public overlay does not
  publish the application's `web`/`websecure` entrypoints.
- **Authentication, which the panel does itself.** `PORTTA_AUTH_MODE=disabled`
  answers every request as the local operator, and whether that is a choice or
  an open door depends on who can reach the address. `domain` and `public`
  require `PORTTA_AUTH_MODE=required` and are refused without it, by
  `portta config set` in either direction and by the panel's own process at
  boot, because they answer whoever finds the address. `local`, `tailscale` and
  `vpn` may run without a login: the reachable set is already an authenticated
  set — this machine, a device somebody enrolled in the tailnet, a client
  holding a VPN credential — so a second credential closes nothing that was not
  already closed. The one combination the access mode does not settle is `local`
  bound to something other than loopback, which is the LAN and not an
  authenticated set; without `PORTTA_AUTH_ALLOW_LAN=true` in `.env` the panel
  refuses to start there. `doctor` **fails** on exactly the combinations the
  panel would refuse and **warns** on every accepted one, because "no login"
  should never be invisible. When it does sign people in, the panel does it
  against its own database: a session cookie for a person, a `ptt_` Bearer token
  for a CLI or an agent, and a role that decides what each may do. Every
  operation declares the permission it needs, `401` and `403` mean different
  things, and a revoked token or a banned user stops working on the next request
  rather than the next sign-in. A `vpn` panel also defaults to read-only, and
  `doctor` warns on any panel that is both reachable and writable. See
  [Configure authentication](../guides/authentication.md),
  [ADR 0035](../../development/adr/0035-authentication-lives-in-the-panel.md) and
  [ADR 0051](../../development/adr/0051-authentication-is-optional-inside-a-trusted-network.md).
- **Live channels.** The event stream needs `activity:read` and filters every
  event against the principal that opened it; an event about a Project somebody
  does not reach is never delivered, and an event about no Project at all goes
  only to `scope: 'all'`. The log WebSocket is authorised *before* the
  handshake becomes a socket — `logs:read`, scoped to the Project that adopted
  the environment — and a refusal is answered as HTTP and then closed, never
  left hanging. One `upgrade` listener owns every `/ws/…` path, including the
  ones it refuses. Query parameters are validated before anything uses them,
  and the stream comes from the Docker API through the panel's own socket
  proxy: nothing is concatenated into a command.
- **Traefik configuration.** The panel may write three filenames in
  `config/traefik/dynamic/` and refuses every other path in its own process.
  See [ADR 0011](../../development/adr/0011-bounded-traefik-write-surface.md).
- **Temporary shares.** A share is one additional hostname for one service,
  with a mandatory expiry, on a network the gateway already answers: it exposes
  a hostname, never a network. Sharing a datastore, a service off the shared
  network, anything public without `PUBLIC_ENABLED`, and a password over
  plaintext on a remote profile are all refused rather than warned about. The
  password is generated, shown once and stored only as a hash. See
  [Share a service](../guides/sharing.md).
- **Docker.** Its own socket proxy, not Traefik's, which stays read-only. It
  grants the read endpoints, container lifecycle and the four fixed exec
  endpoints used by the scoped console, and denies images, volumes, arbitrary
  exec, build, swarm, secrets, plugins and the system endpoints. The panel then
  refuses to emit any call outside its own allowlist, so `prune`, arbitrary
  `exec`, `archive` and `attach` are denied even where the proxy would forward
  them. See [ADR 0008](../../development/adr/0008-web-panel-socket-proxy.md).
- **Blast radius.** A removal always sends `v=0&link=0`: volumes, networks and
  images outlive the container. The only container the panel can create is the
  socat TCP bridge, with a fixed image and no host access at all. Gateway
  components cannot be removed from it.

A mutating request and every browser WebSocket upgrade must come from the
panel's own origin, so a page on another site cannot drive it through
`127.0.0.1`. `PORTTA_WEB_READ_ONLY=true` refuses every write, which is the
right setting when an agent is driving it.

`PORTTA_MCP_HTTP=true` adds a second way in for agents: the tools `portta mcp`
serves over stdio, served by the panel itself at `POST /api/mcp`. It is off by
default because it goes wherever the panel goes — loopback, a tailnet, a VPN
or a public hostname, exactly as `PORTTA_WEB_EXPOSE` decides — so exposing the
panel exposes it. It is behind the same principal as every route: a protected
panel refuses the exchange without a `ptt_` token, and what a tool may do is
what that token holds. On an open panel every call through it is an agent's,
under the `agentPermissions` ceiling, whatever the request declared; the one
tool that reads the host, `resolve_project`, is not served. See
[ADR 0054](../../development/adr/0054-mcp-tools-are-shared-and-served-over-http.md).

### Applying settings, and what it costs

`PORTTA_APPLY=true` widens the panel's reach past that fence, and the
`.env.example` template ships it **enabled**. With it, `portta up` prepares a
stopped container holding the Docker socket, whose command is fixed at
creation, and the panel gains a button that starts it.

Said plainly: **anyone who can write through the panel can then run `portta up`
on this host, in a root container holding the socket** — which is root on the
host. The sharpest edge is `PORTTA_PROFILE`, which the Settings page can already
write: saving `remote-public` and applying puts every opted-in service on the
internet with nobody at a terminal.

What bounds it: only an edit of `.env` on the host changes it, because
`PORTTA_APPLY` is deliberately absent from the panel's field catalogue, so the
panel cannot enable itself. It is refused in read-only mode, refused when the
panel is exposed publicly, and refused on the `remote-public` profile. The
applier takes no argument from the panel, has no network, and the panel gains no
new Docker permission for it — `start` was already allowed. The server security
tests fail the build if the proxy flags or the allowlist grow. See
[ADR 0026](../../development/adr/0026-applying-settings-from-the-panel.md).

Set it to `false` on any host whose panel is reachable by someone you would not
hand a shell.

### Operating a project, and what it costs

`PORTTA_RUNNER=true` is the second setting that widens the panel past the
socket-proxy fence, and the `.env.example` template also ships it **enabled**.
With it, `portta up` prepares a
stopped container holding the Docker socket and a view of the host filesystem
at `/host`, whose command is fixed at creation (`scripts/lib/runner-exec.sh`).
The panel's part is to write `{ verb, project }` and start that container.

Said plainly: **anyone who can write through the panel can then run a closed
set of Compose verbs against a project on this host**. The verbs are `up`,
`stop`, `restart`, `build`, `down` and `down-volumes`. Adding one is an
ADR-level change.

What bounds it: only an edit of `.env` on the host changes it, because
`PORTTA_RUNNER` is deliberately absent from the panel's field catalogue. Set it
to `false` where that trade is wrong. It is
refused in read-only mode, refused when the panel is exposed publicly, and
refused on the `remote-public` profile. The runner takes no command line from
the panel. The working directory comes from Docker's own labels, not from a
path the request supplied. Rebuild is `build` (volumes preserved). Removal
is `down` or `down-volumes`; directory removal is a flag on `down-volumes`
only, refused on a dirty tree unless overridden, and bounded to the
resolved working directory. The project name is typed back and checked on
the server. See [ADR 0030](../../development/adr/0030-the-panel-and-a-project-lifecycle.md).

## The audit log

Who did what, to what, and from where. Written by the panel to its own
database, read at **Settings → Audit** and at `GET /api/audit` with
`audit:read` — which only `owner` and `admin` hold.

What is recorded is a closed list, fixed in
[ADR 0035](../../development/adr/0035-authentication-lives-in-the-panel.md) and in
`packages/core/src/audit-actions.ts`: signing in, signing out and a failed
sign-in; every change to an account, a role, a password, a ban, a session or a
Project membership; tokens created and revoked; Projects created, updated and
deleted; an environment started, stopped, restarted, rebuilt, destroyed or
forgotten; a service restarted; a container operated or removed; a bridge
opened or closed; a share created or revoked; settings changed; the gateway
applied; and a schema migration that actually applied something.

What is deliberately **not** recorded:

- **Development work.** Work sessions, commits and what happened around an issue
  are the work record and live in `activity_events`, which the Activity page
  reads. Mixing
  them in would bury the ten entries that matter under a thousand that do not.
- **Reads.** Nobody's browsing is logged. The log answers "who changed this",
  not "who looked at it".
- **Anything that authenticates.** No request body, no password, no hash, no
  token, no environment value. Each entry carries a small object the caller
  chose — a role, a list of setting *names*, a count — and a scrubber redacts a
  field named like a secret or a value shaped like one (`ptt_…`, a scrypt
  hash, a PEM header) before it is written. `packages/server/tests/audit*`
  passes a token through and asserts it does not come out.

An entry keeps the email of the account it is about, so it stays readable after
that account is deleted and its `user_id` goes null. Addresses come from
`X-Forwarded-For`, which is the proxy's claim: it is recorded as such and used
to decide nothing. Entries are pruned after 180 days by the hourly maintenance
job.

## Secrets

- `.env` is git-ignored; `bootstrap` creates it `0600`; `doctor` warns if it
  becomes group- or world-readable.
- `portta inspect` prints `<set>` / `<unset>`, never values.
- Gateway state, including ACME material, lives under `state/`, which is
  git-ignored. `acme.json` is kept `0600` and `doctor` fails if it is not.
- Lint fails the build on tracked Tailscale auth keys or PEM private keys.
- The gateway never reads a consumer project's `.env` to "helpfully" print
  credentials. Connection strings it shows are templates unless the operator
  opens the connection panel, which reads the container's own environment
  for that one request.
- The web panel's API never returns a secret value except
  `GET /api/access/services/:project/:service/connection`, which is the only
  route that may include a discovered password. The value is not cached, not
  persisted, not written to the panel's database, and not used as an OpenAPI
  example. A redaction helper strips it from anything that would be logged.
  Every other route reports whether a secret is set, and writing `.env` goes
  through a temporary file with mode `0600`.
- The panel's own database has no credential at all: it is a file, and reaching
  it is reaching the host's filesystem. It sits under `state/panel/`, which the
  installation owns, and a backup of it is as sensitive as the installation
  itself ([Back up and restore the panel](../guides/backup-restore.md)).

For Cloudflare, use a scoped API Token limited to `Zone:DNS:Edit` on one zone.
Never the Global API Key: it authenticates everything in the account and cannot
be scoped or usefully rotated.

For Tailscale, prefer an ephemeral, tagged, pre-authorized auth key so a leaked
key ages out on its own.

## Header aliasing

A header named `X_Auth_User` becomes `X-Auth-User` once CGI, WSGI, PHP or nginx
normalises it, which lets a client forge a header Traefik believes it controls.
`PORTTA_ALIAS_HEADERS_STRATEGY` selects `keep` (Traefik's default, fine
behind loopback), `delete` or `reject`. The public profile raises it to
`delete`.

## Shell safety

The CLI runs every program as an executable plus an argument array, with no
shell in between, and parses `.env` rather than sourcing it (a backtick in a
value cannot execute). Project names and service names coming from Docker
labels are validated before they are used as arguments.

The container console is a stronger, separately granted boundary. Only owner
and administrator hold `container:console`; developer, viewer and the default
agent do not. The browser never supplies a command, user or privilege flag:
the server chooses `/bin/bash` or `/bin/sh` for a running service resolved from
an environment and refuses Portta's own containers. Sessions have idle and
maximum limits, and opening and closing are audited without recording commands
or output. See [Open a container console](../guides/container-console.md) and
[ADR 0043](../../development/adr/0043-container-console-over-docker-exec.md).

## What is not protected

Settings → Environment includes a read-only Host security report for the SSH
server, host firewalls and Fail2ban. Its probes use only an explicit command
allowlist, never `sudo`, and store only named configuration values — no host key
paths, tokens, banned addresses or raw command output. Findings are contextual:
password authentication is a recommendation on a public server and neutral on
an isolated workstation. A permissions failure is reported as indeterminate.

The report is guidance, not hardening automation. Portta never changes sshd, a
firewall, Fail2ban, a user or a port; see [Configure firewall rules](../guides/firewall.md)
for operator-controlled commands.

- **Firewall.** Docker's published ports bypass UFW, so the bind address is
  the boundary the gateway actually relies on. See
  [Configure firewall rules](../guides/firewall.md).
- **Project authorization and multi-user identity.** A project can opt one
  router into Portta's single-credential ForwardAuth with
  `portta-forward-auth@file`; Portta does not add roles, accounts or edit that
  project's labels. Use the VPN or a full IdP when that is the boundary needed.
- **A panel that asks nobody who they are.** Where `PORTTA_AUTH_MODE=disabled`
  is accepted, the boundary is the network's rather than Portta's: a tailnet ACL
  that admits a device admits an operator, and a stolen VPN profile is a stolen
  panel. There is no per-user attribution either — activity, sessions and audit
  record the local operator. `doctor` warns and names the assumption instead of
  implying a boundary nothing enforces.
- **Multi-tenancy.** Every project on a host shares one Traefik and one shared
  network. This is a single-developer or single-team tool.
- **Container escape.** The gateway reduces Docker API exposure; it does not
  harden the runtime itself.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.

## Outbound network access

The panel makes exactly two kinds of outbound request, and neither leaves the
host: Traefik's API on an internal address, and the host daemon on
`host.docker.internal`, which the panel is always wired to.

**It holds no forge credential, and makes no call to a forge.** Issues are read
and written by the operator's own `gh`, or by Linear's API with a key in the
daemon's environment — both on the host, in a process the operator started
([ADR 0018](../../development/adr/0018-github-issues-through-the-gh-cli.md),
[ADR 0047](../../development/adr/0047-host-daemon-and-panel-proxy.md)). A panel
that is routed over a VPN therefore gains no route to the internet by being
routed, and there is no long-lived key in `state/` for it to lose.

What that moves rather than removes is the trust in the daemon's token: whoever
can read `state/host/token` can drive the daemon, and through it the operator's
`gh`. That token is as sensitive as the operator's shell and is treated that
way — `0600`, never in `.env`, never in a response, never in a log. The panel
mounts it read-only.

Without a running daemon, issue views say the provider could not be reached and
nothing else changes. See [Connect GitHub](../guides/github.md) and
[Run the host daemon](../guides/host-daemon.md).
