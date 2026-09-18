# 0001. The gateway is infrastructure, not a parent project

**Status:** Accepted; see [0030](0030-the-panel-and-a-project-lifecycle.md), [0047](0047-host-daemon-and-panel-proxy.md)

## Context

Several projects, and several worktrees of the same project, need to run at
once on one machine. Each wants web on 3000, an API on 8000, Postgres on 5432
and Redis on 6379. Only one process can hold a given host port, so today the
usual fix is to stop somebody else's containers or renumber ports inside a
project. Both are bad: the first breaks other people's work, the second makes a
development environment differ from production for no reason.

The obvious-looking solution is a single Compose project that owns everything.
That would work and it would be a trap: projects would have to live in one
directory tree, share a release cycle, and hand over ownership of their volumes
and databases to a tool none of them chose.

## Decision

Portta is installed once per host and stays completely decoupled from
the projects that use it.

It **does not**: move or clone projects, mount their directories, own their
containers, volumes, networks or databases, or take part in their lifecycle.
It never stops a consumer container, never removes a consumer volume, and never
runs `docker system prune`.

Integration is a small contract, nothing more:

1. the project attaches its published HTTP services to an external Docker
   network the gateway owns;
2. those services set `traefik.enable=true`;
3. the project sets a unique `COMPOSE_PROJECT_NAME`.

The recommended shape for that contract is a separate overlay file the project
owns, `compose.portta.yaml`, so the project's own Compose file keeps
describing the application and nothing else, and still runs standalone.

Everything the gateway creates is labelled `portta.managed=true`, and
every destructive path checks that label first.

## Consequences

Good: any Docker project can adopt the gateway by adding one file; projects
stay in their own repositories; the gateway can be removed without touching
anyone's data; several gateways could even coexist on different networks.

Costs: the gateway cannot fix a project that misconfigures itself. It can only
detect and report, which is why `doctor` and `analyze` carry so much weight. It
may operate a project's runtime state on request, through one opt-in runner
with a closed verb set ([ADR 0030](0030-the-panel-and-a-project-lifecycle.md))
and a host daemon the operator starts
([ADR 0047](0047-host-daemon-and-panel-proxy.md)); it still owns nothing.
