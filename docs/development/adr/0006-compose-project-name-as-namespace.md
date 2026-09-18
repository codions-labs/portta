# 0006. `COMPOSE_PROJECT_NAME` is the namespace for parallel environments

**Status:** Accepted

## Context

Running the same project several times, a worktree per issue or one environment
per agent, needs every piece of per-environment state to be distinct:
containers, networks, volumes and hostnames. Inventing a gateway-specific
registry of environments would duplicate something Docker Compose already does.

## Decision

`COMPOSE_PROJECT_NAME` is the single namespace. Compose already derives
container names, the default network and volume names from it, and the gateway
derives hostnames from it (ADR 0005). Setting it is enough:

```bash
COMPOSE_PROJECT_NAME=base-empresarial-issue59 docker compose up -d
```

The contract adds two rules that follow from this:

- **No `container_name:`.** A fixed container name is global to the host and
  makes the second copy of a project fail to start.
- **No shared external volumes across namespaces**, or two worktrees end up
  writing to one database.

The gateway keeps no registry of environments. `urls`, `status` and `doctor`
discover everything from Docker labels at call time.

## Consequences

Parallel environments cost one environment variable and no gateway-side
bookkeeping, and an environment disappears completely when its Compose project
is torn down.

The cost is that the namespace is the user's responsibility. Two projects that
pick the same name collide; `doctor` detects the resulting hostname and Traefik
service-name collisions and reports them.
