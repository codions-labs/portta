# 0017. The panel speaks the Docker Engine API directly

**Status:** Accepted

## Context

The panel needs a small part of the Docker Engine API to discover containers,
show logs and metrics, react to events, perform explicit lifecycle actions and
create the single constrained bridge shape used by temporary TCP access.

That client is also a security boundary. Every request passes through the
allowlist in `packages/server/src/services/docker/allowlist.ts` before it reaches the panel's
filtered socket proxy. The client has no generic request method exposed to
route handlers. Container removal always preserves volumes and links, and
bridge creation explicitly denies binds, mounts, privileges and added
capabilities. [ADR 0008](0008-web-panel-socket-proxy.md) describes the two
layers together.

`dockerode` is a mature Docker SDK, but its purpose is to expose nearly the
whole API. It includes operations this panel deliberately cannot perform,
including exec, image and volume management, prune, archives, builds and
remote daemon transports. Wrapping it would retain our facade while moving the
allowlist away from the transport that actually emits requests.

The production dependency comparison was repeated on 2026-09-01 with Node 24
and npm 11, using `npm ls --omit=dev --all --parseable` for the panel and an
isolated `npm install --package-lock-only --omit=dev dockerode@5.0.1`:

| Production tree | Resolved packages, excluding the root |
|---|---:|
| Current panel | 12 |
| `dockerode@5.0.1` alone | 66 |

The SDK tree still includes SSH, gRPC, Protocol Buffers, tar streaming and
optional native compilation support that the panel does not use.

An unversioned request path would let a newer daemon answer using a response
contract newer than the project's supported baseline, so every request names
its API version.

## Decision

The panel continues to use its purpose-built Docker client and does not add a
general Docker SDK.

The client pins every request to Docker Engine API `v1.43`. That is the API
implemented by Docker Engine 24, the minimum version declared in
`docs/product/reference/compatibility.md`. A newer daemon continues to serve that version, while
an installation below the supported minimum is already rejected by the
project's compatibility checks.

The transport-level allowlist remains the primary reason for this decision.
The dependency measurement supports it, but a smaller SDK would not be enough
on its own if it made the request boundary less explicit.

## Consequences

- A route handler cannot reach an Engine endpoint the allowlist does not name.
- Tests can inspect the exact versioned URL, query and JSON body emitted by the
  panel rather than only the options passed to another client.
- The runtime adds no Docker SDK, remote transport, archive or build tooling.
- We continue maintaining the response types, event parser and Docker log
  demultiplexer used by the panel.
- New Engine operations require an explicit allowlist entry, a client method
  and tests. API version changes require an intentional code and documentation
  change.

## Reversal conditions

Reconsider this decision if at least one of these becomes true:

1. The panel deliberately adds streaming exec or attach, image or volume
   management, BuildKit, or TLS/SSH transport to a remote daemon.
2. The Engine protocol gains behavior the small client cannot reasonably
   implement or verify.
3. `ALLOWED_ENDPOINTS` grows materially beyond roughly 25 entries, making the
   hand-written surface more expensive than a maintained SDK.

Any reversal still has to preserve a transport-level allowlist and the
literal body guarantees for destructive operations. Convenience alone is not
a reason to widen the panel's Docker authority.

## Alternatives considered

**Adopt dockerode directly.** Rejected because its broad API is the opposite
of this layer's defining constraint and its unused dependency surface is
large.

**Put dockerode behind the current facade.** Rejected because it keeps the
facade, adds the full dependency tree and weakens enforcement from the request
transport to call-site convention.

**Use `docker-modem` alone.** Rejected because native `fetch` already provides
the transport needed here, while docker-modem still brings remote-transport
machinery and no useful domain types.

**Send unversioned requests.** Rejected. Pinning `v1.43` makes the protocol
contract match the project's documented Docker 24 baseline.
