# 0024. A service has endpoints, not an access mode

**Status:** Accepted

## Context

Portta answered one question about reachability — *what is the domain of this
project?* — and derived every URL from the answer.
[ADR 0022](0022-project-domain-modes.md) improved the answer by making the base
a mode rather than a value, but it did not change the shape of the question, and
the shape is the problem.

A machine does not have *a* way to be reached. The same host can be, all at
once: a loopback address, a LAN address, a tailnet address, a public address, a
name under a wildcard the operator owns, and a hostname served through an
outbound tunnel. Which of those exist is a property of the **host**. Which of
them a given service uses is a decision about that **service**. Collapsing both
into one project-wide domain forces one answer where several are correct, and
produces the failure that started this: a panel read over the internet
confidently advertising `demo-web.localhost`.

Three distinct things had been fused into that single value:

| | |
|---|---|
| **what a service is called** | a hostname |
| **where the gateway listens** | `PORTTA_BIND_ADDRESS`, `PUBLIC_ENABLED` |
| **who may reach it** | nothing modelled this at all |

The third was simply missing. `portta share` had the beginnings of it — three
states, per service, with an expiry — but only over whatever network the gateway
already sat on, and only as an extra hostname.

## Decision

**Three layers, each answering exactly one question.**

```
Capabilities        what this host can do          detected
  └── Providers     how an endpoint can be made    offered when the capability allows
      └── Endpoints the concrete URLs              created when the operator says so
```

### Capabilities are detected, never configured

`localhost`, `lan`, `tailscale`, `tailscale-dns`, `tailscale-https`,
`tailscale-funnel`, `public-ipv4`, `auto-domain`, `custom-domain`,
`cloudflare-tunnel`, `cloudflare-access`, `https`.

Each carries one of six states, because yes/no loses the distinction that
matters most — between what this host *cannot* do and what it *could*, as soon
as somebody decides:

```
unavailable   configurable   configured   available   active   error
```

`error` is deliberately a state and not a hidden failure: a tunnel that is set
up and not connected is the single most useful thing to say, and the version of
this model that dropped it produced an empty panel with no explanation. A test
pins that behaviour.

Detection lives outside `packages/core`: the panel's services read the
installation and the host and build the facts
(`packages/server/src/services/access.ts`). The verdicts — which facts add up
to which state — live in `packages/core/src/capabilities.ts`. The split is what
lets the verdicts be tested without a host (`capabilities.test.ts` and
`endpoints.test.ts` drive them from hand-written facts) and keeps
`packages/core` free of process execution.

### A capability is not an exposure

This is the load-bearing rule. Detecting that a host has a public address, a
tailnet, or a working tunnel publishes **nothing**. Every optional provider is
off until it is turned on, one service at a time. The tests state it as plainly
as the prose does: a host with every capability available and no exposure
enabled produces exactly two endpoints, `internal` and `local`.

### A service has several endpoints, at once

```
Service: web

  internal   web:3000                                    other containers
  private    http://web--shop.100-87-243-7.sslip.io      the tailnet
  public     https://web--shop.portta.app                the internet
```

Each endpoint carries the one sentence a panel must never get wrong — `scope`,
with six values from `internal` to `public` — and two booleans that are not the
same question:

- **`usable`** — does this URL work right now?
- **`shareable`** — can it be sent to somebody else?

A `local` endpoint can be perfectly usable and never shareable. A public
hostname can resolve correctly and be useless, which is exactly the case that
motivated the field: `domainReachesBind` checks that the name resolves to an
address Traefik actually listens on, so a wildcard pointing at a host whose
Traefik is on loopback is reported as broken rather than offered as a URL.

### Datastores get `host:port` endpoints, never an HTTP hostname

A service whose kind is not `http` is never given an HTTP hostname: Postgres
and Redis are reached over the access network, a TCP route or an SSH bridge,
and offering them a URL would be offering something that cannot work. This
matches the refusal `portta share` makes.

A datastore whose protocol can be told apart by hostname
(`isHostnameRoutable` / `tcpEntrypoint`, [ADR 0009](0009-tcp-routing-by-hostname.md))
gets one endpoint per provider that can carry it — `local`, `lan`, `tailscale`,
`auto-domain`, `custom-domain` — as `host:port`. A kind whose `TcpRouting` is
`unsupported` or `unevaluated` gets exactly the internal endpoint, whatever
providers are enabled. A live loopback bridge is a `bridge` endpoint with scope
`local`. Discovering an address never creates a route.

## Consequences

**`portta share` becomes a special case of this, not a parallel system.** A
share is an endpoint with an expiry and a credential. It keeps its own file and
its own commands; the model now has a place for it to belong.

**The panel can show the truth.** "This name resolves here, and Traefik is
not listening on it" is a sentence a single project-wide domain cannot form;
it would print a URL instead.

**More state to detect, some of it over the network.** Capability detection runs
probes — `tailscale status`, a Docker inspect, a log grep. It is read-only by
construction and never authenticates anything, but it is not free, so it is
gathered once per request rather than per service.

**Exposures are per service.** A project with six services has six independent
decisions available. Everything defaults to off.
