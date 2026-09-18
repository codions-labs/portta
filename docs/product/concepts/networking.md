# Networking

## Container ports vs host ports

This distinction is the whole reason the gateway exists.

**Container port.** The port a process listens on inside its container. It is
namespaced per container. Twenty containers can all listen on 5432; they cannot
see each other unless they share a network.

**Host port.** Created only by a `ports:` entry, which asks the daemon to bind
a port on the machine. Exactly one process can hold it.

Almost every "port already in use" in local development comes from publishing
something that did not need publishing.

### The rule

> Never change an internal port to avoid a conflict.

If `3000` collides, the fix is to stop publishing it, not to move to `3001`.
Keeping internal ports identical to production is worth protecting; the host
port was an accident of tooling.

| Service | Internal | Published on the host? |
|---|---|---|
| web | 3000 | no, routed by hostname |
| api | 8000 | no, routed by hostname |
| postgres | 5432 | no, use `portta access open` |
| redis | 6379 | no, use `portta access open` |
| Traefik | 80 / 443 | yes, once, for the whole machine |

## The networks

### `portta`: shared, external

Created by `bootstrap`, owned by the gateway, joined by every service that
should receive HTTP traffic.

```yaml
networks:
  portta:
    external: true
    name: portta
```

`external: true` means Compose expects it to exist and will neither create nor
remove it, which is exactly the decoupling we want. It survives
`portta down` and
is never removed automatically, because other projects are attached.

Only HTTP-facing services join it. A database on this network is reachable by
every other project on the host; `doctor` warns when it finds one.

### `portta-control`: internal

`internal: true` gives it no route to the outside world. It carries exactly one
conversation: Traefik asking the socket proxy what containers exist.

### `portta-web`: internal, with the panel

Exists only while the panel is enabled. `internal: true`, and it carries only
the panel and its own socket proxy.

### `portta-access`: TCP routing and forwarders

Used by persistent TCP forwarders and, with `PORTTA_TCP=true`, joined by
Traefik so an opted-in datastore can be routed by TLS server name. A datastore
joins this network, never the shared HTTP one. See
[Configure TCP routing](../guides/tcp-routing.md).

### `<project>_default`: private, per project

Compose creates one per project, named from `COMPOSE_PROJECT_NAME`. This is
where Postgres, Redis, queues and search belong. Two projects get two networks
and cannot resolve or reach each other.

## Multi-homed services

A service reachable through the gateway sits on two networks:

```yaml
services:
  web:
    networks:
      - default        # to reach postgres, redis, ...
      - portta    # to receive traffic from Traefik
```

Because the container then has two addresses, Traefik has to be told which one
to dial. Two settings cover it:

- `providers.docker.network=portta` on the gateway (the default), and
- `traefik.docker.network=portta` on the container (explicit, per service).

Without them Traefik may pick the private address, which it cannot reach.

## Hostnames

```text
<compose-project>-<service>.<domain>
```

| Environment | Hostname |
|---|---|
| `demo-shop` / `web` | `demo-shop-web.localhost` |
| `demo-shop-issue59` / `api` | `demo-shop-issue59-api.localhost` |
| on a VPS | `demo-shop-web.vpn.dev.example.com` |

Both parts are normalised to lowercase `[a-z0-9-]`. One subdomain level, not
two, so a single wildcard certificate covers everything
([ADR 0005](../../development/adr/0005-hostname-convention.md)). How the base is chosen, and how
that is not the same as public access, is
[Addresses and access](addresses-and-access.md).

To override, set an explicit rule. It wins over the derived hostname:

```yaml
labels:
  - "traefik.http.routers.myapp.rule=Host(`something-else.localhost`)"
```

## Traefik service names share one namespace

This one bites people. Traefik service names are flat across the whole host: if
two projects both declare

```yaml
- "traefik.http.services.web.loadbalancer.server.port=3000"
```

Traefik merges them into **one** load balancer with two backends, and project A
starts receiving project B's traffic. Always prefix with the namespace:

```yaml
- "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

`doctor` reports the collision if it happens.

> **Write labels in list form.** Compose interpolates `${VAR}` inside a list
> entry but **not** inside a mapping key. In map form the service name stays the
> literal `${COMPOSE_PROJECT_NAME}` and every worktree collapses onto one
> service. `doctor` fails on a literal `${` in a Traefik label.

## Non-HTTP traffic

Traefik routes HTTP by `Host` header. Raw TCP protocols, the PostgreSQL and
Redis wire protocols among them, carry no hostname on the connection, so they
cannot be multiplexed onto one port that way. They are reached through
per-session loopback bridges ([Open a TCP bridge](../guides/tcp-access.md)), or,
with `PORTTA_TCP=true` and TLS, routed by the TLS server name on one port per
protocol ([Configure TCP routing](../guides/tcp-routing.md)).

## Diagnostics

```bash
portta status          # profile, listeners, route count
portta urls            # every hostname currently served
portta doctor          # binds, exposure, collisions, isolation
docker network inspect portta
```
