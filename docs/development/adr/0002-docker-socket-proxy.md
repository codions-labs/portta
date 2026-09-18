# 0002. Traefik reaches Docker through a filtered read-only proxy

**Status:** Accepted

## Context

Traefik's Docker provider needs to read the container list and the event stream
to discover routes. The common recipe bind-mounts `/var/run/docker.sock` into
the Traefik container. The Docker API is not namespaced: a process that can
reach that socket can create a privileged container and is therefore root on
the host. Traefik is the one component in this design that is exposed to
network traffic, so it is the last place that access belongs.

## Decision

Traefik never sees the Docker socket. A `tecnativa/docker-socket-proxy`
container mounts it **read-only** and republishes a filtered subset of the API
over TCP:

- allowed: `CONTAINERS`, `NETWORKS`, `EVENTS`, `PING`, `VERSION`
- denied: everything else, including all writes (`POST=0`)

The proxy sits alone with Traefik on `portta-control`, a network created
with `internal: true`, and publishes no host port. Traefik talks to it at
`tcp://socket-proxy:2375`.

`doctor` fails if the socket is mounted into Traefik, if the proxy mount is
writable, if the proxy publishes a host port, or if the control network is not
internal.

## Consequences

A compromised Traefik cannot start containers or reach the host.

Two limits are worth stating plainly. First, `/containers/{id}/json` is
required for discovery and includes container environment variables, so a
compromised Traefik could still read secrets that consumer projects pass as
env vars. That is inherent to Traefik's Docker provider, not to this proxy.
Second, the proxy is a small HAProxy configuration doing path filtering, not a
policy engine; it reduces blast radius rather than eliminating it.

`wollomatic/socket-proxy` was considered as an alternative: it offers finer
regex-level allowlisting and mTLS. The Tecnativa image was chosen for its much
wider deployment and simpler configuration surface. Switching later means
changing one image and its environment block.
