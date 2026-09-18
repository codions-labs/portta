# 0003. Traefik static configuration lives in environment variables

**Status:** Accepted

## Context

Traefik takes its static configuration from a file, from CLI flags, or from
environment variables, and the three are **mutually exclusive**. Traefik's own
documentation is explicit that mixing them is unsupported.

That forces a real choice, because our static configuration varies by profile:
the local profile serves plain HTTP on loopback, the private profile serves the
tailnet, the public profile enables ACME. We compose profiles as Compose
overlays, so the configuration mechanism has to compose too.

- A **config file** reads best but cannot be templated by Compose; profiles
  would need a generation step and the generated file could drift from `.env`.
- **CLI flags** interpolate fine, but Compose *replaces* `command:` wholesale
  when overlays are merged, so each profile would have to restate the entire
  flag list.
- **Environment variables** interpolate from `.env` and Compose *merges*
  `environment:` maps across overlay files.

## Decision

Static configuration is `TRAEFIK_*` environment variables in
`docker/compose/compose.yaml`, with each profile overlay contributing only the
keys it changes.

Dynamic configuration (middlewares, TLS options) stays in real YAML under
`config/traefik/dynamic/`, loaded by the file provider and hot-reloaded. That
keeps the split the Traefik documentation recommends: static in one place,
dynamic in another.

## Consequences

Profiles stay small and additive, and every value traces back to a documented
variable in `.env.example`.

The cost is readability: a long `environment:` block is less pleasant than a
YAML tree, and keys are shouty (`TRAEFIK_PROVIDERS_DOCKER_EXPOSEDBYDEFAULT`).
Nested keys also need care: `aliasHeadersStrategy` is
`TRAEFIK_ENTRYPOINTS_WEB_HTTP_ALIASHEADERSSTRATEGY`, under `http`, not directly
under the entry point. When a key is wrong Traefik refuses to start and says
exactly which node it could not decode, so mistakes surface immediately rather
than silently.
