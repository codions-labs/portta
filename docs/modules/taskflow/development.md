# Development and testing

Taskflow is developed inside the Portta monorepo with Portta's toolchain, rules
and validation policy. Read [Development setup](../../development/development-setup.md),
[Monorepo layout](../../development/monorepo.md) and [Testing](../../development/testing.md)
first; this page adds only what is particular to the module.

## Toolchain

Production code targets Node.js 24. Install dependencies once from the repository root:

```bash
npm ci
```

Tests run with Vitest or the native Node test runner.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `packages/core/src/taskflow/` | domain models, pure policies, identity, paths, and environment variable names (`config.ts`) |
| `packages/core/src/modules/taskflow.ts` | the module manifest: permissions, activity kinds, documentation directory |
| `packages/contracts/src/taskflow/` | API route table, zod schemas, `fetch` client; the generated `packages/contracts/taskflow.openapi.json` |
| `packages/host/src/modules/taskflow/` | the host module (`index.ts`), lifecycle and Run services, infrastructure adapters, and the HTTP/SSE/WebSocket layer in `server/` |
| `packages/host/src/modules/taskflow/workflows/` | deterministic workflow DSL, standalone engine CLI, and provider workers |
| `packages/host/workflows/` | built-in workflows, bundled as `dist/assets/workflows` |
| `packages/cli/src/commands/flow/` | the `portta flow` command tree and its handlers |
| `packages/cli/src/modules/taskflow*.ts` | mounting `portta flow`, the `portta mcp` tools and the `portta doctor` checks |
| `apps/web/modules/taskflow/` | the panel's Taskflow pages |
| `skills/portta-workflows/` | packaged agent-facing workflow guide, bundled as `dist/assets/skills/portta-workflows` |
| `docs/modules/taskflow/` | this documentation and its `navigation.json` |

## Run the daemon from source

```bash
npm run dev:taskflow --workspace portta-host
```

This runs the host daemon's entry point (`packages/host/src/bin.ts`) with `tsx --watch`, on `127.0.0.1:5111` unless `PORTTA_HOST_BIND` or `PORTTA_HOST_PORT` say otherwise. Its state directory is `PORTTA_HOST_STATE_DIR`, or `state/host` under `PORTTA_ROOT` (the working directory when unset), so point it at a scratch directory rather than your real installation's state when experimenting.

To run the CLI against it, use the checkout launcher:

```bash
./bin/portta flow project ls
```

`./bin/portta` rebuilds the CLI bundle when its sources change. `npm run cli:link` puts that launcher on `PATH` as `portta`; `npm run cli:unlink` removes it.

To run the built daemon exactly as an installation does:

```bash
npm run build --workspace=@codions/portta   # dist/cli.js, dist/host.js, dist/supervisor.js, dist/assets
./bin/portta host serve
```

## Tests

```bash
npm run test --workspace portta-host     # vitest, then test:node and test:workflows
npm run test --workspace @codions/portta # the portta flow tree, MCP tools and doctor checks
```

`portta-host`'s `test` runs three suites: Vitest (`tests/*.test.ts` and `src/**/*.test.ts`), `test:node` for the native `node --test` suites (`*.node.ts` and the process runner), and `test:workflows` for the workflow engine under `tests/modules/taskflow/workflows`. Following the repository policy, run the matching file while working and the owning workspace only when several modules there changed:

```bash
npm exec --workspace portta-host -- vitest run src/modules/taskflow/server/host-http.test.ts
npm test --workspace=@codions/portta -- flow/index
```

## Backend conventions

- Define domain and API types before implementation.
- Keep HTTP/WebSocket handlers thin and delegate to typed services.
- Separate pure decision logic from filesystem/process/network adapters.
- Prefer discriminated unions and explicit return types; do not use `any` or suppression directives.
- Represent expected operational failures as result unions rather than exceptions.

An API change starts in the contract: add or change the route in `packages/contracts/src/taskflow/contract.ts` and its schemas, register the handler with `projectRoute`/`contractRoute` in the matching `server/routes/<group>.ts`, then regenerate the OpenAPI document and commit it:

```bash
npm run openapi:taskflow --workspace portta-contracts
npm run openapi:taskflow:check --workspace portta-contracts
```

A route the panel should forward must also be named in the panel's permission table with the Portta permission it needs; an unnamed route is a `404` that never reaches the daemon. See [Host daemon and module proxy](../../development/host-daemon.md).

## Frontend conventions

- Use React function components, typed props, hooks, and mobile-first layouts.
- Keep API calls in `apps/web/modules/taskflow/lib/api/`, query hooks in `lib/queries/`, shared interfaces in `lib/types.ts`, and user-facing text in `apps/web/modules/taskflow/messages/{en,pt-BR}/`.
- Extract repeated components and pure transformations instead of copying UI behavior.
- Use theme variables/Tailwind utilities and preserve safe-area behavior on mobile.
- Keep panel and CLI parity for every user-facing capability.

## Workflow engine conventions

Workflow source is untrusted JavaScript. Changes to the DSL must preserve the sandbox, deterministic replay, stable call keys, fan-out limits, structured validation, cancellation, and provider-neutral worker contract.

Workflow files are not ordinary JavaScript modules: the Taskflow DSL permits a top-level `return`.

Update these surfaces together when authoring behavior changes:

- engine types/runtime;
- standalone CLI help;
- `skills/portta-workflows/SKILL.md`;
- [Workflow authoring](workflows.md); and
- relevant built-in examples/tests.

## Testing multiplexers safely

Never use a developer's live tmux server for destructive integration tests. Use the isolated wrapper:

```bash
bash packages/host/tests/support/run-with-isolated-tmux.sh <test-command>
```

Tests can additionally set the dedicated `PORTTA_FLOW_ISOLATED_TMUX_*` variables. Clean up only the explicitly created temporary socket/config.

## Test layers

- Pure/unit tests cover policies, parsers, reducers, workflow primitives, and provider protocol normalization.
- Adapter tests cover Git, filesystem, SQLite, tmux/herdr, Docker, and subprocess boundaries.
- Contract tests keep panel/CLI requests aligned with the daemon's schemas, and `openapi:taskflow:check` keeps the committed OpenAPI document aligned with the registered routes.
- `packages/host/tests/app.test.ts` covers the daemon's token check and module mounts; `packages/server/tests/modules-proxy.test.ts` covers the panel's forwarding.

When fixing a bug, reproduce it with a failing test when practical. When the cause is uncertain, add temporary high-context logs at entries/exits, branch decisions, identifiers, and I/O payload boundaries; reproduce; fix from evidence; then remove the logs.

## Documentation workflow

These pages are published with Portta's documentation. Every Markdown file in `docs/modules/taskflow/` must be listed in its `navigation.json`, and links are validated like the rest of the corpus. When behavior changes:

1. update the corresponding CLI/API/config types and tests;
2. update the canonical guide here;
3. run `npm run docs:check`, and `npm run docs:generate` when it reports a stale generated file.

See [Contribute documentation](../../development/documentation.md).

## Release notes

Taskflow has no release of its own: it ships inside `@codions/portta`, whose publication is described in [Publish the Portta CLI to npm](../../development/publish-cli.md). Record notable module changes in Portta's `CHANGELOG.md`.
