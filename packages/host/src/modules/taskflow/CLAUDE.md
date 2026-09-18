### Node-first

- Production code targets Node.js 24 and uses only Node's APIs: `node:fs/promises`, `node:child_process`, `process.env`, and `node:timers/promises`. No other runtime's globals, test imports or type packages enter production sources.
- The Portta host daemon (`packages/host/src/bin.ts`) owns the listener, the token and the WebSocket upgrade; `index.ts` is the module it mounts at `/api/modules/taskflow` and `/ws/modules/taskflow`. `server/host.ts` composes the Projects, `server/app.ts` builds the Hono app from injected dependencies and `server/ws/upgrade.ts` binds the socket routes to their Project — no module-level singletons or top-level await. Workflow Runs call `runWorkflow` in-process.
- Every HTTP route comes from the contract table in `portta-contracts/taskflow` and is registered in `server/routes/<group>.ts` with `projectRoute`/`contractRoute`, which validates params, query and body and documents the route for OpenAPI. Regenerate `packages/contracts/taskflow.openapi.json` with `npm run openapi:taskflow --workspace=portta-contracts` after an API change.
- Use Vitest or the native Node test runner for all active tests and npm for workspace tooling.

### TypeScript strictness

- `strict: true` in tsconfig — no exceptions.
- No `any`. No `as` casts unless narrowing from a validated boundary (e.g., JSON parse). No `@ts-ignore` / `@ts-expect-error`.
- Prefer `satisfies` over `as` for type assertions where possible.
- Use discriminated unions for message types (e.g., WebSocket protocol).
- All function signatures must have explicit return types.

### Architecture

- One module = one concern. Keep the current flat `src/` structure — no deep nesting.
- Pure functions for logic, side-effectful functions clearly separated.
- New features should be unit-testable: extract business logic from I/O boundaries.
- Prefer returning `Result`-style objects (`{ ok: true, data } | { ok: false, error }`) over throwing for expected failures.

### Planning new features

- Define types/interfaces first, implement second.
- Identify the I/O boundary (HTTP handler, WebSocket message, CLI command) and keep it thin — delegate to typed, testable functions.
- If a feature touches multiple modules, plan the interface contract between them before writing code.
- Write tests for pure logic. Mock I/O boundaries with typed stubs.
