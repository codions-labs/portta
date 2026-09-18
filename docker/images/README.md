# Operational images

These directories are self-contained build contexts for images used by the
Portta runtime rather than by a Compose service directly:

- `apply/` builds the opt-in applier that recreates the gateway after settings
  change.
- `toolbox/` builds the pinned diagnostic and database-client toolbox.
- `sandbox/` builds `ghcr.io/codions-labs/portta-sandbox`, the agent sandbox
  Taskflow's Docker profiles use; see its README.

Application images stay with their applications. In particular,
`apps/web/Dockerfile` remains under `apps/web` because it builds the web and
authentication workspaces from the repository-root context.
