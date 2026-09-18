# 0007. Traefik runs inside the Tailscale container's network namespace

**Status:** Accepted

## Context

On a VPS, the gateway should be reachable from the developer's machine and from
nowhere else. Three ways to arrange that were considered.

**A. Publish on the host and bind the tailnet address.** Simple, but it needs a
host-native Tailscale daemon so there *is* a tailnet address to bind, and the
address has to be known before Compose runs. It also leaves a published port
whose bind address is the only thing standing between private and public.

**B. Tailscale as an L4 forwarder.** Keep Traefik ordinary and have Tailscale
forward tailnet 80/443 into it, via `TS_SERVE_CONFIG` TCP forwarding or
`TS_DEST_IP`. This composes beautifully, since Traefik never changes shape, but
`TS_DEST_IP` needs a container IP that is not stable, and the serve config's
TCP forwarder is documented mainly with loopback targets. Building the core
private-access path on a capability we could not verify was not acceptable.

**C. Share the network namespace.** `network_mode: service:tailscale` merges
the two containers' namespaces, so Traefik listens directly on the tailnet
interface. This is the pattern Tailscale's own Docker guidance and the wider
community converged on.

## Decision

Option C, as the default for `remote-private`. Option A remains supported and
documented for hosts that need a host-native Tailscale anyway (subnet routing,
Tailscale SSH to the host, exit-node behaviour). Set `TAILSCALE_ENABLED=false`
and point `PORTTA_BIND_ADDRESS` at the tailnet address.

Three settings follow from the choice and are not optional:

- `TS_USERSPACE=false`, with `/dev/net/tun` and `NET_ADMIN`. Userspace mode has
  no interface in the namespace, so an inbound connection would never land on
  Traefik.
- `TS_ACCEPT_DNS=false`. MagicDNS rewrites `resolv.conf`, and Traefik shares
  this namespace: Docker's resolver has to keep working or discovery breaks.
- `TS_AUTH_ONCE=true` with `state/tailscale/` persisted, so the node identity,
  and therefore the address DNS points at, survives a restart.

Because `networks:` and `network_mode:` are mutually exclusive, and Compose
merges rather than replaces both, Traefik's attachment cannot live in the base
file and be undone later. `docker/compose/compose.yaml` therefore declares
neither, and exactly one overlay under `docker/compose/attach/` supplies it.

## Consequences

In the private profile the VPS publishes **nothing** on its public interface.
There is no firewall rule to get wrong, which matters more than usual here
because Docker's published ports bypass UFW.

Costs: Traefik cannot have its own published ports in this mode, so the public
profile publishes on the Tailscale container instead, which is why
`PORTTA_BIND_ADDRESS` is interpreted by whichever container owns the
namespace. The dashboard overlay needs a Tailscale-flavoured twin for the same
reason. And `doctor` has to verify the namespace sharing explicitly, because a
Traefik that quietly failed to join it looks healthy while being unreachable.

This path is **not covered by automated end-to-end tests**, because it needs a
real tailnet and a real VPS. Configuration tests assert that the profile renders and
never binds `0.0.0.0`; the rest is a documented manual checklist in
`docs/product/guides/remote-development.md`.
