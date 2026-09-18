# 0048. A module exposes endpoints through Traefik, in one bounded file of its own

**Status:** Accepted; see [0011](0011-bounded-traefik-write-surface.md)

## Context

Taskflow runs environments per worktree and needs to hand an operator a URL for
a service inside one: an app on a Dev Container port, a preview a workflow
started. Taskflow did this with its own gateway on port 80 and a forwarding
table. Portta already has a gateway, and one rule about writing to it:
[ADR 0011](0011-bounded-traefik-write-surface.md) lets the panel write only
named files in Traefik's dynamic directory, atomically and with mode `0600`.

Leaving a module to run its own gateway would mean two things listening for the
same hostnames. Letting the host daemon write Traefik configuration would mean a
second writer, outside the panel, with no allowlist.

## Decision

**A module's endpoints are Traefik routes in one generated file per module,
written only by the panel's existing dynamic writer.**

- The file is `portta-module-<id>.yaml`. The allowlist in
  `packages/server/src/services/dynamic.ts` grows by exactly the registered
  modules' names, derived from the server module registry
  ([ADR 0046](0046-official-modules-are-composed-at-build-time.md)); every other
  path stays refused, and files the operator wrote are never touched.
- The panel writes it. The host daemon reports what can be exposed — a port, a
  target reachable from the gateway network — through the module's API; it
  never writes a Traefik file.
- A route is HTTP on a hostname derived by the same rules as every other
  ([ADR 0023](0023-flat-hostname-labels.md)), on the gateway's domain. It carries
  the ForwardAuth middleware ([ADR 0027](0027-forward-authentication-service.md))
  unless the operator shares it the way a service share is shared.
- Exposing and revoking are permissions of the module, audited like shares.
  Revoking a route rewrites the file without it.
- A module's own gateway, published host port or forwarding table is not
  allowed.

## Consequences

- Every URL Portta hands out answers through one Traefik, with one TLS and
  authentication story.
- The bounded write surface stays bounded: one more file per module, named in
  code, with the same atomic write and mode.
- Endpoints reachable only on the host's loopback need a target the gateway
  network can reach; that is the module's problem to solve, not Traefik's.
- `MODULE_FILES` in `packages/server/src/services/dynamic.ts` lists one file
  per registered module (`moduleEndpointsFile(id)` in
  `packages/core/src/module-endpoints.ts`), so the write surface is fixed by
  the build, not by the installation.
