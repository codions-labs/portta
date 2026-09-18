# Compatibility reference

## What is actually tested

Claims here are limited to what is exercised. Nothing is listed as supported
because it "should" work.

| Platform | Status |
|---|---|
| macOS 15+ (arm64) + OrbStack | **Verified**, full suite run by hand during development |
| Ubuntu 24.04 (amd64) + Docker Engine | Integration in PR CI; full E2E on release tags |
| macOS + Docker Desktop | **Expected to work, not verified.** Nothing here uses an OrbStack-specific API. |
| Debian 12 + Docker Engine | **Expected to work, not verified.** |
| Linux arm64 | **Expected to work, not verified.** Every pinned image publishes arm64. |
| Windows / WSL2 | **Untested.** Loopback and `*.localhost` behave differently enough that it needs its own verification. |

Minimum versions: Docker Engine 24, Docker Compose 2.24.4. `setup` refuses an
older Docker Engine, `adopt` and `runtime up` refuse an older Compose, and
`doctor` reports the versions it found. The shell scripts the runtime ships run
on bash 3.2, which is what macOS ships.

## Remote profiles

The `remote-private` and `remote-public` profiles are covered by configuration
tests: every profile renders, the private profile never binds `0.0.0.0`, and
the rendered private profile shares Traefik's network namespace with Tailscale.

The parts that need real credentials (a tailnet, an ACME account, a DNS zone)
are **not exercised by any automated test**. [Choose remote access](../guides/remote-development.md) has a
smoke checklist to run by hand after a first deploy, and
[Configure persistent Tailscale services](../guides/tailscale-services.md) states which half of that feature is tested.

## Overhead

Measured on macOS 15 / OrbStack / arm64, with four environments and eight
routed services running.

| | Memory | Notes |
|---|---|---|
| Traefik | ~48 MiB | the only permanently running router |
| Docker socket proxy | ~25 MiB | HAProxy, read-only |
| `portta-auth` | not measured | ForwardAuth for protected project hostnames |
| **Traefik + proxy** | **~73 MiB** | for the whole machine, not per project |
| Access bridge | ~1.4 MiB | one per open session, removed on close |
| Toolbox client | ~0 | exists only while the command runs |

| | Time |
|---|---|
| `bootstrap` (idempotent, no pull) | ~4 s |
| `doctor` (full diagnostics) | ~3 s |
| Traefik discovering a new route | under 1 s |

Traefik, the socket proxy and `portta-auth` are the standing footprint of the
gateway; the optional panel adds its own container and socket proxy. Bridges are
created per session and removed, clients are one-shot, and the toolbox image is
built once and then only run on demand.

For comparison, the thing this replaces, a published host port per service,
costs no memory but costs a port, which is the resource that actually runs out.

## Images

Every version is pinned; see
[ADR 0004](../../development/adr/0004-pinned-versions.md) for the table and the update process.

All pinned images publish both `amd64` and `arm64`, so the same configuration
runs on an Apple Silicon Mac and an x86 VPS without changes.

## Reporting a platform

If you run this somewhere not listed, the useful report is:

```bash
uname -s -m
docker version --format '{{.Server.Version}}'
docker compose version --short
bash --version | head -1
portta version
portta doctor --json
```
