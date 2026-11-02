# 0011. The panel has a bounded Traefik write surface

**Status:** Accepted; see 0048

The panel reads Traefik's API for runtime routing facts. Its dynamic directory
is writable only so it can materialize three current decisions:

- `portta-aliases.yaml` for environment aliases;
- `portta-shares.yaml` for expiring service shares;
- `portta-auth.yaml` for protected project and share routes;
- `portta-module-<id>.yaml`, one per registered module, for a module's
  endpoints (ADR 0048).

Every write passes through the filename allowlist in
`packages/server/src/services/dynamic.ts`, uses an atomic replacement and mode
0600, and refuses every other path. Files outside that allowlist belong to the
operator and are never modified by the panel.
