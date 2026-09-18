# 0025. One tunnel, one wildcard rule, and Traefik keeps routing

**Status:** Accepted

## Context

Every way Portta could publish a service until now required the host to be
reachable from outside: a public address, ports 80 and 443 open, and something
listening on them. That rules out the cases people most often have — a home lab,
a machine behind CGNAT, a laptop, a VPS whose provider firewalls inbound by
default.

Cloudflare Tunnel inverts the direction: `cloudflared` dials **out** to
Cloudflare and traffic arrives back down that connection. The question was
whether it fits Portta's architecture or fights it, and specifically whether
publishing a service through it would need a Cloudflare change **per service** —
which would make it useless for a gateway whose whole premise is that starting a
container is enough.

## What was measured

Not assumed. On a real host, against a live tunnel, with `cloudflared`
2026.8.3.

**A wildcard ingress rule matches every derived hostname.**
`cloudflared tunnel ingress validate` accepts `hostname: "*.portta.app"`, and
`ingress rule` matched `web--demo.portta.app` and `api--demo--pr-42.portta.app`
against that single rule, while `portta.app` and other zones fell through to the
catch-all. Wildcards are documented as one level and not usable mid-hostname,
which is exactly what [ADR 0023](0023-flat-hostname-labels.md) already requires.

**The Host header survives to the origin.** This is the linchpin, so it was
verified end to end rather than read. Through a live tunnel from the public
internet, the container received:

```
Host: windsor-ipod-among-cst.trycloudflare.com
Cf-Connecting-Ip: 2804:1b2:…
X-Forwarded-Host: windsor-ipod-among-cst.trycloudflare.com
```

The original Host arrives unchanged, which is the only thing Traefik routes on.
`httpHostHeader` would override it, so the generated configuration deliberately
never sets it.

**Traefik routes behind the connector, dynamically.** With the tunnel already
running and unchanged, the hostname returned Traefik's own 404. Adding a router
made it return 200 from the container; removing it made it stop. **No Cloudflare
API call, no DNS change, no connector restart** — which is the whole hypothesis,
confirmed.

**WebSocket works.** `HTTP/1.1 101 Switching Protocols` end to end, from the
public internet through the edge, the connector, and Traefik to the container.

**Failure modes are distinguishable**, which matters for the troubleshooting
guide:

| What is broken | What the caller sees |
|---|---|
| origin container stopped | `502` |
| connector stopped | `530`, Cloudflare "Tunnel error" (1033) |
| nothing routed for that hostname | Traefik's own `404` |

**Universal SSL covers the wildcard, for free.** `*.portta.app` is a first-level
subdomain and is covered; a second level is not, and needs a paid add-on. See
[ADR 0023](0023-flat-hostname-labels.md).

**Proxied wildcard DNS records are available on every plan.** Cloudflare's DNS
documentation states it plainly: "Customers on all plans can create and proxy
wildcard DNS records."

## Decision

**Cloudflare Tunnel is an exposure provider, not the architecture.**

It takes its place beside the others in
[ADR 0024](0024-capabilities-providers-endpoints.md) and replaces none of them.
Publishing a port stays exactly as it was; a host that has a public address and
wants to use it, does.

**The connector carries one ingress rule for the whole gateway:**

```yaml
ingress:
  - hostname: "*.portta.app"
    service: http://traefik:80
  - service: http_status:404
```

Everything dynamic happens below that line, inside Traefik, which already routes
by Host and already learns about containers from Docker labels. Responsibilities
divide cleanly, with no overlap:

| | |
|---|---|
| **Cloudflare** | TLS at the edge, the wildcard DNS record, Access policies |
| **cloudflared** | one outbound connection; the wildcard rule; nothing per service |
| **Traefik** | routing by Host, exactly as it does on every other profile |
| **Portta** | generating the connector's config, running it, reporting its state |

**The connector runs as a container.** Everything else the gateway runs is a
container, pinned to a version ([ADR 0004](0004-pinned-versions.md)), updated by
pulling an image. A host install would be the one component with a different
lifecycle, update path and uninstall. It joins the shared `portta` network and
nothing else, so it can reach Traefik by name and has no route into any
project's private network. An operator who already runs `cloudflared` under
systemd keeps it: detection finds that connector and the overlay stays off.

**Credentials go in a file, never on a command line.** `tunnel run --config`
rather than `--token`, because a token on a command line is visible in `ps` to
every user on the host. The credentials file is written `0600` beside the
generated config and mounted read-only.

**One route is written by hand, once.** `*.portta.app CNAME <uuid>.cfargotunnel.com`,
proxied. The UUID is not a secret: `cfargotunnel.com` only accepts records from
the account that owns the tunnel.

**Portta never touches the Cloudflare account.** It does not create tunnels, DNS
records, or Access applications, and it does not hold an API token to do so.
`portta tunnel setup` prints what to create and where; the operator creates it.
That is the same line [ADR 0007](0007-tailscale-sidecar.md) and `docs/product/guides/tailscale.md`
already draw around a tailnet: Portta reports what somebody else's account
allows, and changes nothing in it.

## What this does not solve

**Quick tunnels are a debugging aid, not a deployment.** `trycloudflare.com`
needs no account, which makes it excellent for exactly the verification above,
and it hands out a **new hostname on every connector restart** — confirmed:
`windsor-ipod-among-cst` became `proceeding-observed-discrete-cookbook`. It also
buffers `text/event-stream`, so Server-Sent Events never arrive. Named tunnels
have neither problem. Portta configures named tunnels only.

**The apex is not covered.** `*.zone` does not match `zone`; verified. A gateway
that should answer on the apex adds a rule for it, which `includeApex` does.

**Access is Cloudflare-side state.** Portta records that a policy exists so an
endpoint can be labelled `protected` rather than `public`. It cannot verify one
and does not try; a claim it could not check would be worse than no claim.

**Latency and dependency.** Traffic goes through Cloudflare rather than to the
host, which was 0.36s from Brazil via a US data centre in testing. When
Cloudflare is down, so is the endpoint. Publishing a port has neither property,
which is why both remain.

## Consequences

**A machine with no public address can publish HTTPS.** That is the case this
exists for, and it needs no port open, no static address, and no certificate on
the host.

**Adding a project stays a Docker operation.** No Cloudflare change, ever, after
the one-time setup. This is the property that made the feature worth building
rather than documenting as a manual recipe.

**The tunnel is the one public endpoint that ignores the bind address.** Every
other public URL depends on where Traefik listens; this one does not, because
the connector reaches Traefik from inside the network. The endpoint model
handles it as a deliberate exception, with a comment saying why.

**One more moving part, and one more outage surface.** A connector that stops
takes every tunnel hostname with it, and reports `530` rather than anything
Portta can explain from the inside. `doctor` checks the connector's registered
connections for exactly this reason.
