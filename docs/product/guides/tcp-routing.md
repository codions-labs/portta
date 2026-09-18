# Configure TCP routing

One host port per protocol, any number of instances behind it, told apart by
the hostname the client asks for:

```text
storefront-postgres.localhost:5432      -> storefront's postgres:5432
checkout-postgres.localhost:5432        -> checkout's postgres:5432
storefront-redis.localhost:6379         -> storefront's redis:6379
```

No project renumbers a port. No container publishes one. Traefik owns `:5432`
and `:6379` on the host and picks the backend from the TLS Server Name
Indication. The matrix is the short answer; the reasoning, the designs that
were rejected and the measurements are in
[ADR 0009](../../development/adr/0009-tcp-routing-by-hostname.md).

## The matrix

| Protocol | Port | Same IP and port, told apart by hostname | Strategy | TLS | Local | VPS |
|---|---:|---|---|---|---|---|
| PostgreSQL | 5432 | **Yes** | STARTTLS then SNI, TLS terminated at Traefik | Required, `sslmode=require` | Yes | Yes |
| Redis / Valkey | 6379 | **Yes**, with an explicit `--sni` | TLS-first, SNI, terminated at Traefik | Required, and the client must be told the name | Yes | Yes |
| MySQL | 3306 | **No** | Not possible with Traefik. Falls back to a loopback bridge | n/a | Bridge | Bridge |
| MariaDB | 3306 | **No** | Same as MySQL | n/a | Bridge | Bridge |
| MongoDB | 27017 | Not evaluated | TLS-first, likely feasible | Would be required | - | - |
| Elasticsearch / OpenSearch | 9200 | Not evaluated, and unnecessary | It speaks HTTP, so the existing HTTP router already does this | - | - | - |
| Memcached, AMQP, MQTT, SMTP | various | Not evaluated | Each needs its own answer | - | - | - |

"Not evaluated" means exactly that. Nothing here is marked possible without a
client actually connecting to the right instance.

## How each protocol is routed

**PostgreSQL** negotiates TLS with STARTTLS: the client opens a plain
connection, asks for TLS, and the handshake that follows carries the Server
Name Indication Traefik routes on. libpq sets SNI by default since PostgreSQL
14, so asking for TLS at all (`sslmode=require`) is the only client-side
requirement. The gateway's TLS options advertise the `postgresql` ALPN
identifier that libpq 17 and later offer; older clients connect through the
same entrypoint.

**Redis** has no STARTTLS: a TLS client sends its ClientHello first, which is
the easy case. The one wart is `redis-cli`, which does **not** derive SNI from
`-h`: `--sni <host>` is mandatory, and the panel prints the whole command.
Most libraries set SNI from the host they were given (node-redis and ioredis
through `tls.servername`, redis-py through its SSL context); verify yours.
Backends are untouched: Redis needs no `tls-port`, no certificate and no
configuration change, because Traefik terminates TLS and speaks plain RESP to
the container.

**MySQL and MariaDB** cannot be routed this way: the server speaks first, so
there is no SNI at the moment a proxy must choose a backend. They keep the
mechanism every protocol has: a loopback bridge on a port the kernel picks,
opened when you need it (`portta access open`, or the Access page). See
[Open a TCP bridge](tcp-access.md).

## Termination, not passthrough

Traefik terminates TLS itself and speaks plaintext to the backend, with the
wildcard certificate the gateway already issues. Containers stay unchanged
and need no TLS configuration; plaintext only ever travels on the Docker
network between Traefik and the container, the same trust boundary the HTTP
routers already use. The cost is honest: the gateway sees the traffic. On a
workstation it already runs everything; on a VPS it is the component that
terminates HTTPS anyway.

## Naming

The convention is flat, the one the gateway uses for HTTP
([ADR 0005](../../development/adr/0005-hostname-convention.md)):

```text
<compose-project>-<service>.<domain>

storefront-postgres.localhost
storefront-redis.localhost
checkout-postgres.vpn.example.com
```

One wildcard covers every service of every project, HTTP and TCP alike, and
`portta tls init` issues exactly that. A nested shape such as
`postgres.storefront.<domain>` does not survive certificate validation, because
a wildcard covers exactly one label. Nobody invents a hostname: the gateway
derives it from the labels Compose already sets.

## Networks: datastores still do not join the HTTP network

The gateway's shared `portta` network carries HTTP services. Databases do not
belong on it; Compose validation and routing tests reject that attachment.

TCP routing does not change that. A datastore that opts into hostname routing
joins **`portta-access`**, the network that already exists for reaching
private TCP services, and Traefik joins it too:

```text
portta          HTTP services            <- Traefik, web, api
portta-access   opted-in TCP services    <- Traefik, postgres, redis
portta-control  the socket proxy         <- Traefik only, internal
<project>_default    everything else          <- Traefik has no route
```

A database that does not opt in is on its project network and nothing else,
reachable only through a bridge.

## Exposure

Being visible to the gateway is not being published. Three things have to line
up before a database answers on a host port:

1. `providers.docker.exposedByDefault` stays `false`, so a container is routed
   only when it carries `traefik.enable=true`;
2. the project's overlay has to add the TCP router labels and join the access
   network, which is a deliberate edit in the project's own repository
   ([manual mode](adopting-projects.md#manual-mode), from
   [`templates/overlays/09-tcp-routing.yaml`](../../../templates/overlays/09-tcp-routing.yaml));
3. the gateway has to have the TCP entrypoints enabled at all, which is
   `PORTTA_TCP=true` and off by default.

Where the entrypoints listen follows the profile, the same as everything else:

| Profile | Bind | Who can reach a database |
|---|---|---|
| `local` | `127.0.0.1` | this machine |
| `remote-private` with Tailscale | the tailnet address | your tailnet, subject to its ACLs |
| `remote-private` without Tailscale | `PORTTA_BIND_ADDRESS` | whoever can reach that interface |
| `remote-public` | **refused** | nobody: the gateway will not start TCP entrypoints on a public profile |

The last row is a hard refusal, not a warning. `public enable` is about HTTP
services that opted in; a database is never part of that, and
`service publish --public` is refused for datastores. TCP entrypoints keep the
same rule.

Credentials are unaffected: the gateway routes bytes and never reads a
project's `.env`. Authentication stays PostgreSQL's and Redis's own.

### What a hostname that matches nothing gets

Not a closed connection. A Traefik entrypoint serves HTTP as well as TCP, and
when no TCP router matches the SNI the connection falls through to the HTTP
side, which answers `HTTP/1.1 404 Not Found`. No database is reached, so this
is not a security hole. It is a diagnostic one: the client reports whatever it
makes of an HTTP response rather than "unknown host":

```text
$ redis-cli -h 127.0.0.1 -p 6379 --tls --sni typo-redis.localhost get k
Error: Protocol error, got "H" as reply type byte
```

`H` is the first byte of `HTTP`. Read that error as *the hostname matched no
router* — a typo, a project that is not running, or a container whose route
Traefik has not picked up yet. `portta urls` and the panel's Access page
show the hostnames that do exist.

## Local, on macOS with Docker Desktop or OrbStack

Nothing extra is needed, which is the point.

- **DNS.** `*.localhost` resolves to loopback at any depth on macOS. No
  `/etc/hosts`, no dnsmasq, no resolver file.
- **Ports.** Traefik publishes `127.0.0.1:5432` and `127.0.0.1:6379`. The VM
  boundary is irrelevant: it is an ordinary published port, the same mechanism
  the gateway already uses for 80 and 443.
- **Certificates.** `portta tls init` issues a local CA and a wildcard for
  the domain. `sslmode=require` needs no trust at all; `verify-full` needs the
  CA, which `portta tls trust` explains how to install. `mkcert` is not
  required and would only duplicate what is there.
- **Conflict.** If something already holds 5432 on the host, the entrypoint
  will not bind. `portta doctor` reports it, and the ports are
  configurable.

```bash
psql "postgresql://demo@storefront-postgres.localhost:5432/demo?sslmode=require"
redis-cli -h 127.0.0.1 -p 6379 --tls --sni storefront-redis.localhost
```

## Remote, on Debian or Ubuntu

Same mechanism, different exposure.

- **DNS.** The wildcard record that already points at the host covers these
  names, because they are the same flat namespace as the HTTP ones.
- **Certificates.** The existing ACME DNS-01 wildcard covers them too. HTTP-01
  cannot issue a wildcard, which is why the gateway already uses DNS-01.
- **Tailscale.** With `TAILSCALE_ENABLED=true` Traefik runs inside the Tailscale
  container's network namespace ([ADR 0007](../../development/adr/0007-tailscale-sidecar.md)), so
  the TCP entrypoints listen on the tailnet and nowhere else. This is the
  intended way to reach a remote database.
- **Firewall.** Nothing needs opening for the Tailscale path. Without it, the
  bind address is an interface you choose, and Docker's published ports bypass
  UFW ([Configure firewall rules](firewall.md)).
- **Cloudflare.** DNS only. Cloudflare's HTTP proxy does not forward PostgreSQL
  or Redis, and turning the orange cloud on for these records breaks them
  rather than protecting them. Spectrum is a paid product for arbitrary TCP and
  is out of scope here.

```bash
psql "postgresql://demo@checkout-postgres.vpn.example.com:5432/demo?sslmode=verify-full"
```

## When SNI is not there: the fallback

Three cases produce no SNI, and all three fail the same way. Traefik finds no
matching TCP router and hands the connection to its HTTP muxer, which answers
`HTTP/1.1 400 Bad Request`. The client reports that first byte:

```text
psql:      expected authentication request from server, but received H
redis-cli: Protocol error, got "H" as reply type byte
```

| Cause | Fix |
|---|---|
| `sslmode=disable`, or any non-TLS connection | ask for TLS: `sslmode=require` |
| connecting to an IP rather than a name (RFC 6066 forbids SNI for literal IPs) | use the hostname |
| `redis-cli --tls` without `--sni` | pass `--sni <host>` |

And when hostname routing does not apply at all, MySQL above all, the gateway
falls back to what it already does well: a bridge on a free loopback port,
opened on demand and closed when you are done. Both mechanisms coexist. A
project can be reached by hostname and by bridge on the same day.

## Worth knowing before relying on it

- **Cost.** The extra hop costs about 1.6 ms per connection, most of it the
  TLS handshake. It is paid on connect, not per query, so a pooled application
  pays it once per pool member; a script that opens a connection per statement
  will notice.
- **Reloads.** Traefik applies configuration changes to new connections.
  Established TCP connections are not cut when an unrelated container starts,
  but a router that disappears takes its connections with it.
- **Pooling.** Nothing here interferes with PgBouncer or a client-side pool.
  A pool in front of the gateway, or behind it, both work.
- **Timeouts.** Traefik's TCP timeouts apply. A long-idle psql session behaves
  the same as it does against a bridge.
- **Observability.** `portta logs traefik` shows router matching. There is
  no per-query visibility and there should not be.
