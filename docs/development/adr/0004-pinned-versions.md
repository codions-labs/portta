# 0004. Every component image pins an explicit version

**Status:** Accepted

## Context

This is shared infrastructure: when it breaks, several projects stop being
reachable at once. A floating `latest` tag turns an unrelated upstream release
into an outage at the least convenient moment, and makes two machines running
"the same" gateway behave differently.

## Decision

Every image pins an explicit version tag. As of this writing:

| Component | Version | Why this one |
|---|---|---|
| `traefik` | `v3.7.12` | current stable v3 line |
| `tecnativa/docker-socket-proxy` | `v0.5.0` | current release |
| `tailscale/tailscale` | `v1.102.3` | current stable |
| `cloudflare/cloudflared` | `2026.8.3` | tunnel connector ([ADR 0025](0025-cloudflare-tunnel.md)) |
| `alpine/socat` | `1.8.1.3` | TCP access bridges |
| `alpine` | `3.24.1` | applier and toolbox base |
| `node` | `24.20.0-alpine` | panel image build and runtime |
| `ghcr.io/codions-labs/portta` | `${PORTTA_VERSION}` | published runtime image shared by the panel and ForwardAuth |
| `ghcr.io/codions-labs/portta-sandbox` | `${PORTTA_VERSION}`, on `node:24.20.0-bookworm-slim` | Taskflow sandbox |
| `codions-labs/portta-apply` | generated runtime version | the optional applier and runner ([ADR 0026](0026-applying-settings-from-the-panel.md)) |
| `codions-labs/portta-toolbox` | generated runtime version | local diagnostic and database clients |
| `traefik/whoami` | `v1.12.0` | fixtures only |
| `nginx` | `1.31.4-alpine` | fixtures only |
| `postgres` | `18.6-alpine` | fixtures only |
| `redis` | `8.10.1-alpine` | fixtures only |

The static Compose checks fail the build if any image lacks an explicit tag or
if a `:latest` appears anywhere. `doctor` warns if the running Traefik is on a
floating tag.

We pin tags, not digests. A digest would be stronger against tag mutation, but
it makes the update path opaque, since nobody can tell what `sha256:9f2c…` is
by reading it, and there is no automation here to keep digests fresh. Pinning a
tag we can read and audit is the better trade at this size.

## Consequences

Upgrades are deliberate: change the tag, run `portta update`, which
validates the Compose configuration before pulling and asks before recreating.

The cost is that security updates do not arrive on their own. The
versions above need periodic review, and the CHANGELOG records each bump.
