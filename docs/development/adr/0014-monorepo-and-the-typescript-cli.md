# 0014. The repository is an npm workspace with one TypeScript CLI

**Status:** Accepted

## Decision

Portta is an npm workspace with application code under `apps/`, shared packages
under `packages/`, and operational assets under `docker/`, `config/` and
`templates/`.

The public command is the `@codions/portta` package in `packages/cli`. Its
bundled JavaScript is the sole CLI implementation. `bin/portta` is only a
checkout launcher for that bundle, and installation invokes the published
package directly.

Workspace responsibilities are:

- `packages/core`: pure rules shared by more than one consumer;
- `packages/contracts`: API schemas, types and generated OpenAPI;
- `packages/db`: schema, current baseline migration and database client;
- `packages/auth`: identity and authorization;
- `packages/server`: business rules and integrations;
- `packages/host`: the host daemon and its modules ([ADR 0047](0047-host-daemon-and-panel-proxy.md));
- `apps/web`: the panel UI and process composition;
- `apps/auth`: ForwardAuth for protected application hosts and shares;
- `packages/cli`: commands, host effects, formatting and packaging.

Local facts are derived by Core and executed locally. Persistent decisions go
through the panel API. The CLI never writes the panel's database directly
([ADR 0049](0049-host-state-in-sqlite.md)) and the UI does not reimplement
server rules.

Node 24 or newer is required for the CLI and installer
([ADR 0015](0015-node-is-required-on-the-host.md)). The npm package carries the
runtime Compose, image, template and configuration assets required by
`portta setup`; installing a release does not require a Git checkout.

## Consequences

- A command is implemented once in TypeScript.
- Shared rules have one implementation in Core.
- Package boundaries are enforced by `tests/unit/boundaries.test.sh`.
- Packaging must prove that the CLI starts and that the runtime assets are in
  the npm tarball.
