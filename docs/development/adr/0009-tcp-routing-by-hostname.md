# 0009. Databases are told apart by hostname, with TLS terminated at the gateway

**Status:** Accepted

## Context

The gateway solved port collisions for HTTP by routing on the Host header, so
every project keeps its own internal port and nothing publishes one. Databases
never got that: PostgreSQL, MySQL and Redis carry no hostname on the
connection, so the gateway reached them with a temporary loopback bridge on a
port the kernel picks ([ADR 0002](0002-docker-socket-proxy.md) sits underneath,
[docs/tcp-access.md](../../product/guides/tcp-access.md) explains the mechanism).

That works, and it is per-session. A database you connect to every day means
opening a bridge every day, at a different port each time.

TLS gives back the missing hostname: the Server Name Indication travels in the
handshake, in cleartext, before any application traffic. Traefik can route TCP
on it.

## Decision

The gateway publishes **one entrypoint per protocol** and picks the backend
from SNI. It is opt-in twice over: `PORTTA_TCP=true` on the gateway, and
router labels on the project's own datastore.

Three choices inside that, each with an alternative that was rejected:

**TLS is terminated at the gateway, not passed through.** Passthrough would
mean every project's Postgres and Redis needs a certificate, `ssl = on`, and a
renewal story. Terminating leaves consumer projects completely unchanged, which
is the whole point of [ADR 0001](0001-decoupled-infrastructure.md). The cost is
that the gateway sees the traffic, on a host where it already terminates HTTPS
and runs everything.

**Hostnames are flat: `<project>-<service>.<domain>`.** The obvious
`<service>.<project>.<domain>` cannot be covered by a wildcard certificate,
which matches exactly one label. Verified: routing works, `verify-full` fails
with "server certificate for `*.<domain>` does not match host name". Flat reuses
[ADR 0005](0005-hostname-convention.md) and the wildcard the gateway already
issues.

**Opted-in datastores join the access network, not the shared one.** The shared
`portta` network carries HTTP and does not carry a database. Compose validation
and routing tests enforce that boundary. The access network exists for reaching
private TCP services, so Traefik joins it and nothing else changes.

**MySQL is not supported, and no substitute is invented.** Its protocol has the
server send the first packet, so there is no SNI before a proxy must choose a
backend. ProxySQL, MySQL Router, routing by username and one IP per instance
were all considered and rejected: each adds a component or a change to every
connection string, to make one protocol look like the others. MySQL keeps the
bridge, which still works.

## Consequences

Two PostgreSQL instances can both use 5432 and be reached on one host port,
told apart by hostname, with neither publishing a port. The same for Redis.
Verified with two live instances and distinct data in
`tests/e2e/tcp-routing.test.sh`, which is what keeps it true.

TLS becomes mandatory for these connections, because the hostname lives in the
handshake. `sslmode=require` is enough and needs no trust store; `verify-full`
needs the CA. A client that connects without TLS, or to an IP, gets an
`HTTP/1.1 400 Bad Request` from Traefik's fallback muxer, which surfaces as
"received H". The documentation says so, because the error does not.

The protocol registry lives in one place, `packages/core/src/discovery.ts`, and
a protocol is listed as routable only after two instances were reached through
one port. `unevaluated` is a real state, and the default.

Everything here is additive. With `PORTTA_TCP=false`, which is the
default, nothing changes: the bridges, the clients and the published ports all
behave exactly as before.
