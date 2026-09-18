# 0028. Operational image contexts live under `docker/images/`

**Status:** Accepted

## Context

Portta builds a few helper images that contain only a Dockerfile: the settings
applier and runner, the operational toolbox, the Taskflow sandbox. None of
them is an application or an npm workspace; each exists solely to produce an
operational image. Placed at the repository root they would look like product
subsystems, and Docker assets would be split across unrelated levels.

The panel Dockerfile is different. It belongs to the application lifecycle,
has development and runtime stages, and builds `apps/web` and `apps/auth` from
the repository-root workspace context.

## Decision

Runtime-owned, self-contained image contexts live under `docker/images/`:

```text
docker/
├── compose/                 gateway base and overlays
└── images/
    ├── apply/               settings applier and runner image context
    ├── sandbox/             Taskflow sandbox image context
    └── toolbox/             operational toolbox image context
```

Application Dockerfiles remain colocated with their applications, so the
panel stays at `apps/web/Dockerfile`.

The npm runtime contains `docker/compose/` and `docker/images/`. CLI commands
remain the stable interface.

## Consequences

The repository root contains product subsystems rather than incidental Docker
build contexts. All Docker-owned runtime assets are discoverable below one
directory without separating an application's image definition from its code.

Manual builds use `docker/images/apply/`, `docker/images/sandbox/` and
`docker/images/toolbox/` as their contexts.
