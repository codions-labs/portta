# Configure persistent Tailscale services

A persistent, private address for a TCP service, so the database you use every
day keeps port 5432 and a stable name instead of a fresh loopback port each
session.

> **Verification status.** The forwarder side is implemented and tested: the
> container is created, joins the right two networks, and is reachable by its
> alias on the standard port. The tailnet side
> (the Service advertisement and the grants) is **configuration you apply on
> your own tailnet**, and is not exercised by any automated test here. The
> gateway prints exactly what to apply and never edits your Tailscale policy.

## The architecture, and why it is shaped this way

```text
project-a_default              project-b_default
     postgres                       postgres
        |                               |
  forwarder-a-db                  forwarder-b-db
        |                               |
        +------- portta-access ----+
                        |
                    Tailscale
```

Each published service gets **its own forwarder**, joined to exactly two
networks: that project's private network, and the gateway's access network.

The alternative, attaching the Tailscale container directly to every project's
private network, would be simpler and much worse. It would give one container
a route into every project at once, and it would put projects one
misconfiguration away from resolving each other's service names. The forwarder
per service keeps every project network isolated from every other, and
Tailscale only ever sees the access network.

`portta doctor` fails if a forwarder ends up on the shared HTTP network.

## Publishing one

```bash
portta service publish --private \
  --project demo-shop --service postgres
```

```json
{
  "alias": "demo-shop-postgres",
  "project": "demo-shop",
  "service": "postgres",
  "port": 5432,
  "network": "demo-shop_default",
  "accessNetwork": "portta-access"
}
```

Reachable at `demo-shop-postgres:5432` from the access network.

```bash
portta service list
portta service unpublish demo-shop-postgres
portta service unpublish --project demo-shop
```

Unpublishing removes the forwarder. The database keeps running; it was never
touched.

## Wiring it to the tailnet

Three steps, all on your side.

**1. Let Tailscale reach the access network.**

```bash
docker network connect portta-access portta-tailscale-1
```

This is the only network the Tailscale container joins beyond the gateway's
own. It never joins a project network.

**2. Advertise a Tailscale Service.** Each service gets its own virtual address,
which is what lets several databases keep port 5432 and still be told apart:

```text
svc:demo-shop-postgres  ->  tcp:5432  ->  demo-shop-postgres:5432
svc:demo-site-postgres  ->  tcp:5432  ->  demo-site-postgres:5432
svc:demo-shop-redis     ->  tcp:6379  ->  demo-shop-redis:6379
```

Distinct identities, standard ports, no tunnels.

**3. Grant access, never a blanket rule.**

```jsonc
{
  "grants": [
    {
      "src": ["group:developers"],
      "dst": ["svc:demo-shop-postgres"],
      "ip":  ["tcp:5432"]
    },
    {
      "src": ["group:developers"],
      "dst": ["svc:demo-shop-redis"],
      "ip":  ["tcp:6379"]
    }
  ]
}
```

Deny by default, then name the source, the destination and the port. Note what
is not there: no `*` in `src`, no `*` in `dst`, and no rule that would reach a
service nobody asked to publish.

Check the current [Tailscale Services documentation](https://tailscale.com/docs/features/tailscale-services)
for the exact syntax your tailnet expects. This is the model, not a
copy-paste-and-forget snippet, and the gateway will not apply it for you.

## When to use this instead of a bridge

| | `access open` | `service publish --private` |
|---|---|---|
| Lifetime | a session | until you unpublish |
| Address | `127.0.0.1:<random>` | a stable tailnet name |
| Port | assigned | the standard one |
| Setup | none | Tailscale Service and a grant |
| Good for | debugging, a one-off query, a GUI for an hour | the database you open every morning |

Start with `access open`. Publish the two or three you keep reaching for.

## Not set up for this yet?

`portta remote access open` works over plain SSH and needs no
Tailscale Services configuration at all. See
[Open remote tunnels](remote-tunnels.md).
