# Architecture

## System overview

```text
panel pages (browser), portta mcp            portta flow, portta doctor
        |                                              |
        v                                              |
Portta panel: principal, permission table, proxy       |
        |                                              |
        +------ Authorization: Bearer <state/host/token> ------+
                                   |
                                   v
Typed HTTP / SSE / WebSocket contract at /api/modules/taskflow and /ws/modules/taskflow
                                   |
                                   v
Portta host daemon (portta host serve): the Taskflow module and Project runtimes
   |          |             |
   |          |             +--> RunService --> workflow engine --> native provider workers
   |          +--> workspace/lifecycle services --> Git + Docker + hooks
   +--> session gateway --> tmux or herdr --> human terminal/native agent processes
   +--> local IPC --> ACP runtime supervisor --> ACP agents/terminal commands

Durable state: state/host/taskflow.db + runs/ + <git-common-dir>/portta/ metadata
```

Taskflow is a Portta module ([ADR 0046](../../development/adr/0046-official-modules-are-composed-at-build-time.md)). It runs in the one Portta host daemon per machine ([ADR 0047](../../development/adr/0047-host-daemon-and-panel-proxy.md)), its pages are the panel's Taskflow section, its commands are `portta flow`, and an on-demand machine-local ACP runtime supervisor runs beside the daemon. The daemon serves no dashboard of its own; the standalone workflow engine's live viewer (`portta flow workflows run --open`) is the one process that does. Workflow Runs execute the embedded engine in the daemon; the supervisor only owns ACP subprocess lifetime, terminal commands, ordered operational events, permissions, and cancellation.

`portta flow` commands call the daemon directly with the token from its state directory; the panel and `portta mcp`'s Taskflow tools go through the panel, which authorises each route against a Portta permission before forwarding it.

## Packages and boundaries

### Configuration

`portta-core/taskflow/config` owns product identity, default paths, environment variable names, and path construction. Both CLI and backend use it so global/project/runtime paths cannot drift.

### API contract

`portta-contracts/taskflow` defines the schemas (zod 4) and a plain route table (`apiContract`: method, path, path params, query, body, and response schema per status) shared by frontend, CLI, and backend. `createApi(baseUrl)` derives a `fetch` client from that table. Project routes include configuration, agents, worktrees, integrations, workflow catalog, Runs, events, and transcripts. Global routes manage Projects.

The host registers every contract route with Hono under its contract key: path params, query, and JSON body are validated against the contract schemas before a handler runs, and the route is documented with `hono-openapi`. `npm run openapi:taskflow --workspace portta-contracts` writes the resulting OpenAPI 3.1 document to `packages/contracts/taskflow.openapi.json`; `openapi:taskflow:check` fails when the committed document is stale.

The contract's paths are Taskflow's own; the daemon mounts them below the module's root. Global Project management answers at `/api/modules/taskflow/api/projects`, and each Project's routes at `/api/modules/taskflow/<prefix>/api/...`, for example `/api/modules/taskflow/<prefix>/api/worktrees` and the Run stream `/api/modules/taskflow/<prefix>/api/runs/:runId/stream` (SSE). WebSocket upgrades use the same prefix ownership below the socket mount: `/ws/modules/taskflow/<prefix>/ws/<worktree>` for a terminal and `/ws/modules/taskflow/<prefix>/ws/agents/worktrees/<name>` for agent chat. The panel forwards those paths 1:1.

### Core and runtime

`portta-core/taskflow` contains domain models and pure policies without delivery or infrastructure dependencies. `portta-host/taskflow` contains reusable lifecycle and Run services plus filesystem, Git, Docker, multiplexer, provider, authentication, and persistence adapters.

The module composes:

- domain models and policies;
- filesystem, Git, Docker, multiplexer, provider, authentication, and persistence adapters;
- lifecycle, session, Project, Run, workflow, integration, and presentation services; and
- the module adapter and its HTTP/SSE/WebSocket layer in `packages/host/src/modules/taskflow/`:
  - `index.ts` — `createTaskflowHostModule`, the host module the daemon mounts: it builds the Taskflow host from the daemon's context (state directory, environment, token), brings the multiplexer and the persisted Projects up the first time the daemon asks for its routes, and winds them down on close;
  - `server/host.ts` — `createTaskflowHost`, which composes the Project manager, one Project app per Project, the Hono app, and the WebSocket routes;
  - `server/app.ts` — `createTaskflowHostApp(deps)`, the Hono app: global routes and each Project's route groups under `/:prefix`. The daemon has already checked the token; the runtime events route checks it again because agent hooks, not the panel, call it;
  - `server/routes/<group>.ts` — thin handlers per route group (configuration, environments and endpoints, branches, Project snapshot, agents, worktrees, Linear, GitHub, Runs, notifications, and global Projects);
  - `server/ws/upgrade.ts` — the module's socket routes, `/:prefix/ws/:worktree` (terminal) and `/:prefix/ws/agents/worktrees/:name` (agents UI), bound to the Project their prefix names so an unknown Project is refused before the handshake completes. The daemon's own upgrade listener authenticates the handshake first; and
  - `server/project-app.ts` and `server/project-environments.ts` — per-Project services and state the routes and sockets use.

The daemon's generic half is `packages/host/src/`: `bin.ts` is the process entry (state directory, token, enabled modules, signals), `app.ts` the token check and module mounts, `main.ts` the listener and upgrade handler.

Taskflow ships inside `@codions/portta`, assembled from `packages/cli`. Its `dist/` contains `cli.js`, `host.js` (the daemon `portta host serve` starts as a child process), `supervisor.js` (the ACP supervisor), `assets/workflows` (the built-in workflows from `packages/host/workflows`) and `assets/skills/portta-workflows` (the workflow-authoring skill), so an installed package never reads from the source repository.

The CLI is a [commander](https://github.com/tj/commander.js) command tree. `createFlowCommand()` in `packages/cli/src/commands/flow/index.ts` defines every command, option, alias, and help text, and `packages/cli/src/modules/taskflow.ts` mounts it as `portta flow`, folding the installation's daemon settings into the environment first. Each handler module is loaded when its command runs. Usage lines and examples are derived from the command's position. The same CLI module adds the Taskflow tools to `portta mcp` and the Taskflow checks to `portta doctor`. Child processes the CLI starts itself go through `packages/cli/src/process.ts`: an executable plus an argument array, never a shell string.

Expected failures are represented as typed results at service boundaries. Reconciliation derives live presentation state from durable metadata plus external runtime state.

### Frontend

The React pages live in the panel's module directory, `apps/web/modules/taskflow`, and follow the layout of Portta's panel. `index.ts` declares the web module (rail entry, Project tabs, Settings section, translation namespaces); `containers/` holds one client component per page; `components/<area>` holds the views and dialogs; `styles.css` the Taskflow-only CSS. The route files are Portta's App Router pages under `apps/web/app/(panel)/projects/[slug]/(taskflow)/`, `apps/web/app/(panel)/taskflow/` and `apps/web/app/(panel)/settings/taskflow/`, and the primitives are Portta's own `apps/web/components/ui`. The typed API lives in `lib/api` (thin wrappers over `createApi`), React Query hooks and keys in `lib/queries`, stream-driven cache invalidation in `lib/live.ts`, and translations in `messages/<locale>`. Shared response types live in `lib/types.ts`. Every request the pages make goes to the panel's `/api/modules/taskflow` and `/ws/modules/taskflow` routes, never to the daemon directly.

The same application is responsive: desktop emphasizes the terminal and multi-pane workspace; mobile substitutes native chat for supported agents.

### Workflow engine

`portta-host/taskflow/workflows` contains:

- the sandboxed JavaScript DSL parser/runtime;
- deterministic keys, journal, transcript, progress, and concurrency control;
- workflow catalog metadata and built-ins; and
- provider workers for Codex, Claude Code, OpenCode, and Pi.

The engine exposes a programmatic `runWorkflow` boundary used by the backend and a standalone CLI surface routed through `portta flow workflows`.

### Environment providers

Host, Docker Compose, Dockerfile, and Dev Container support is split across independent insertion points rather than one monolithic runtime:

- `EnvironmentProvider` materializes and observes Host, Docker profile, Compose, or Dev Container environments.
- `ExecutionTransport` streams commands beneath Direct Sessions and Workflow workers.
- `ExecutionPort` owns Run and fork worktrees; it is not a process transport.
- Docker/Compose observation populates the Service Catalog with status and provenance.
- TCP and UDP loopback forwarding are Taskflow's access providers. An `EndpointExposureProvider` (`adapters/endpoint-exposure.ts`) may publish a named HTTP URL in front of an HTTP forward; the host daemon uses the `disabled` provider, so HTTP endpoints report their loopback forward URL. Named URLs through Portta's gateway are the subject of [ADR 0048](../../development/adr/0048-module-endpoints-through-traefik.md).

The official `devcontainer` CLI owns JSONC parsing, configuration resolution, image builds, Compose reuse, startup, Features, users, environment, mounts, and lifecycle hooks; Taskflow calls only `read-configuration`, `up`, and `exec`, and never duplicates those rules or creates the Compose stack itself. See [Dev Containers](dev-containers.md) for the user-facing selection, trust, and lifecycle model built on these boundaries.

## Project and worktree ownership

The Project manager materializes one runtime per configured repository. The lifecycle service owns branch/worktree creation, runtime environment, hooks, Docker, multiplexer layouts, and cleanup. Git is authoritative for checkout topology; Taskflow metadata records product-specific decisions such as profile, agents, ports, tabs, labels, and archive state.

Canonical per-worktree metadata is kept under the shared Git directory. This makes it available from the main checkout and linked worktrees and prevents ordinary checkout cleanup from deleting control state accidentally.

## Session ownership

The session gateway abstracts tmux and herdr. The default mapping is:

```text
Project -> multiplexer session
worktree -> window/session unit
profile pane -> agent, runtime, shell, or command process
browser terminal -> PTY bridge -> persistent multiplexer process
```

Provider-native chat uses dedicated Codex/Claude adapters and normalized conversation services. Terminal and native chat are separate transports over the same worktree/session lifecycle.

ACP is an opt-in agent transport and does not replace the session gateway. An ACP Direct Run creates or reuses a sibling multiplexer shell for human/browser/SSH access while the independent supervisor owns the protocol process. Both are routed to the same host or container workspace, but a multiplexer failure does not block ACP startup.

## Agent Client Protocol runtime

Taskflow supports Agent Client Protocol (ACP) as an opt-in transport for Direct and Workflow Runs. Native provider adapters remain the default. ACP is the structured agent channel, while tmux/herdr provides a human shell in the same checkout and execution environment.

```text
dashboard / CLI
       |
       +-- HTTP/SSE/WebSocket --> host daemon (Taskflow) --> Run and workspace orchestration
       |                              |
       |                              +-- tmux/herdr --> human shell
       |                              |
       |                              +-- Unix socket --> runtime supervisor
       |                                                      |
       |                                                      +-- ACP agent process
       |                                                      +-- ACP terminal commands
       |
       +-- SSH --> tmux attach --> same human shell
```

The supervisor is a small machine-local process, independent of the browser connection and of the host daemon. It is bundled as `dist/supervisor.js` beside `dist/cli.js` and `dist/host.js`, started on demand by the Taskflow module, and outlives daemon restarts. It owns ACP subprocesses, terminal subprocesses requested through ACP, cancellation, permission waits, bounded output, exit status, and an append-only SQLite event log (`state/host/runtime/supervisor.sqlite`, reached over `state/host/runtime/supervisor.sock`). Environment creation, Git/worktree ownership, workflow coordination, and product Run state stay in the host daemon.

### Resource model

| Resource | Owner and identifier | Durable relationship | End condition |
| --- | --- | --- | --- |
| Browser PTY attachment | WebSocket connection | none | browser/socket disconnect |
| Human multiplexer session | tmux/herdr; Project session plus worktree window | Project/worktree metadata | explicit close or hosting process/container/host exit |
| ACP agent process | runtime supervisor; stable operation id | Run Execution points to operation id | completion, cancellation, crash, or environment exit |
| Logical ACP session | agent; opaque ACP session id | supervisor checkpoint and Execution checkpoint | agent-defined; load/resume only when negotiated |
| ACP terminal process | runtime supervisor; ACP terminal id | supervisor terminal events, output, status, and exit code | exit, kill, or release |
| Workflow Run | host daemon and workflow journal; Run/engine ids | Run database, immutable workflow snapshot, journal, Executions | workflow completion, failure, or cancellation |

An ACP agent is deliberately not launched inside the human tmux pane. Attaching over SSH therefore reaches the same filesystem, tools, services, environment, and worktree, but not the agent's conversational UI. Cross-client conversation continuation is available only when the chosen agent both advertises ACP load/resume and gives its CLI a compatible way to address that same session id.

### Selection and permissions

The dashboard exposes **Agent transport** and **Permission mode** on Direct and Workflow Run forms. The matching CLI options are:

```text
portta flow run direct --harness codex --transport acp --permission-mode interactive --input "Implement the change"
portta flow run workflow code-review --transport acp --permission-mode workspace --input "Review HEAD"
portta flow runs permission <run-id> <request-id> <option-id|deny>
```

`--mcp-json` accepts an array of ACP stdio MCP server definitions. Environment values are stored as part of the immutable Run configuration, so do not put secrets there unless storing them in the Taskflow database is acceptable.

Permission modes are intentionally narrow:

- `interactive` is available to Direct Runs; it persists the request and waits for an explicit dashboard or CLI response;
- `workspace` selects only an agent-provided one-time approval and rejects unknown tool kinds;
- `deny` rejects requests.

Taskflow never converts `workspace` into a persistent `allow_always` grant.
Workflow Runs accept `workspace` or `deny`: their deterministic coordinator cannot safely pause and transfer an arbitrary nested agent call to a human client yet.

### Host and container placement

The host daemon and supervisor run on the same host. The supervisor starts host agents directly. For Dockerfile, Docker Compose, and Dev Container environments it starts both the ACP adapter and ACP-requested terminal commands through `docker exec`, using the selected container, its worktree path, and explicit environment variables. The sibling human shell uses the environment provider's normal terminal invocation, so both surfaces target the same environment.

The agent binary and every tool it invokes must exist inside the selected environment. Authentication directories or credentials must be mounted/passed by the Project profile. A persistent volume preserves files only; it does not preserve the agent, terminal, tmux, or workflow coordinator processes when a container is recreated.

The ACP provider registry maps a provider id to the adapter command the supervisor launches. Its defaults are the four builtins:

| Provider | ACP command |
| --- | --- |
| `codex` | `codex-acp` |
| `claude-code` | `claude-agent-acp` |
| `opencode` | `opencode acp` |
| `pi` | `pi-acp` |

`providers:` in `.portta/taskflow.yaml` (and the local overlay) adds entries or replaces a builtin's command; the resolved registry is what a Run on the ACP transport validates provider ids against before it starts.

Native provider bridges remain available for all existing flows and are used whenever `transport` is omitted or set to `native`.

### Long runs, recovery, and cancellation

Stable operation ids make retries idempotent. The supervisor records ordered agent updates, permission requests, terminal output, terminal exit codes, final results, and failures. A workflow agent call uses its deterministic call key in the operation id; completed workflow steps still replay from the workflow journal, avoiding duplicate side effects. An unfinished call is not silently considered complete.

Cancellation first sends ACP `session/cancel`, then sends an interrupt after a grace period, and finally kills the process if necessary. A late process result cannot overwrite the cancelled state.

| Event | tmux/human shell | ACP operation | Workflow coordination | Recovery |
| --- | --- | --- | --- | --- |
| Browser or CLI disconnect | continues | continues | continues | reconnect normally |
| Host daemon restart | continues | supervisor continues | in-memory coordinator detaches; ACP call may finish | reconcile operations, then resume workflow from its journal |
| ACP connection/agent exit | unaffected | terminal result/failure recorded | call completes or fails | load/resume only if negotiated; otherwise restart unfinished call |
| Supervisor crash/restart | unaffected | subprocess pipe cannot be reattached; marked `recovery_required` | coordinator must not assume success | resume logical session if supported, otherwise restart unfinished work |
| Container stop/recreate | host tmux survives, container shell/process does not | process dies | active call fails/interruption is reconciled | recreate environment; files survive only on volumes; resume or restart |
| Host restart | processes do not survive | processes do not survive | coordinator does not survive | restore files/database/journal, then resume/replay or restart |

The workflow engine resumes by re-running deterministic control flow and replaying completed calls from the journal. It cannot reattach JavaScript stack state. Operations reported as `recovery_required` are never presented as successful.

### Concurrency and human intervention

Run workspace claims prevent two Taskflow exclusive writers from owning the same checkout. A human with filesystem or SSH access can still edit it outside that lock, so intervention is cooperative: inspect while an agent runs; before changing files, cancel or wait for the active Run, or use a separate worktree. The separate human terminal prevents two clients from writing bytes into the agent's protocol stream, but it cannot prevent conflicting filesystem changes.

Interactive permission requests provide an explicit control-transfer point. ACP does not define a universal “open this conversation in the provider CLI” operation, and attaching tmux must not be treated as such.

### Protocol scope and limitations

Taskflow currently implements the stable ACP initialize, session new/load/resume, prompt/update/cancel, permission, and client terminal methods. It negotiates and records capabilities instead of assuming session recovery. stdio MCP servers are supported; HTTP and SSE MCP capability flags are recorded but those server transports are not configured by the Run API yet. Session listing, forking, closing, model selection, and agent-specific configuration are not exposed.

The supervisor uses a permission-restricted local Unix socket. It is intentionally smaller than a remote host-management daemon: it does not provision environments or expose a network API. Its SQLite database is operational state, while the normal Run database and workflow journal remain the product sources of truth.

The supervisor is spawned by the daemon's module, on the same host and as the same user. If the daemon itself runs inside a container, the supervisor shares that container's process lifetime; the state directory on a persistent volume preserves records rather than processes. A separately deployed supervisor service is not configurable yet.

### References

Protocol behavior is based on the official [ACP overview](https://agentclientprotocol.com/overview/introduction), [session](https://agentclientprotocol.com/protocol/session-setup), [terminal](https://agentclientprotocol.com/protocol/terminal) and [tool-call](https://agentclientprotocol.com/protocol/tool-calls) documentation.

## Run model

A Run owns its requested mode, immutable input, workspace policy, status, result, and Executions. Run records are stored in SQLite through the Run store.

`WorkspaceFacade` provisions and locks checkout ownership before execution starts. `DirectSessionPort` adapts interactive harness sessions. `WorkflowRunner` invokes the engine and `WorkflowEventBridge` projects engine events into Run/Execution records.

Idempotency keys protect repeated create/cancel/resume operations. State transitions prevent an interrupted or terminal Run from being treated as active.

## Workflow data flow

```text
catalog definition
      |
      v
immutable workflow snapshot + Run row
      |
      v
workspace provision and exclusive/read ownership
      |
      v
in-process engine -> agent calls -> external provider processes
      |                                  |
      +--> journal/transcripts           +--> normalized events/usage/results
      |
      v
event bridge -> Execution projections -> API/SSE -> dashboard
```

The workflow snapshot decouples a durable Run from later catalog edits. The journal serves replay; the database serves unified product history and presentation.

## Streaming

- Binary/terminal WebSockets carry interactive PTY input and output.
- Conversation WebSockets carry normalized native agent chat events.
- SSE carries notifications and Run/execution transcript updates.
- Snapshot-first clients combine a consistent initial read with ordered stream cursors.

The browser is never the owner of an agent process. Disconnecting a client must not terminate persistent work.

## Security model

- The host daemon binds `127.0.0.1:5111` by default, and is never bound to every interface by default. A non-loopback bind, such as the Docker bridge address on Linux, is protected by the same token.
- Every request except `GET /api/health` must present `Authorization: Bearer <state/host/token>` on HTTP requests, SSE requests, and WebSocket handshakes. The token is created once with mode `0600` and never rewritten; there is no second token.
- The daemon holds no user, role or permission. The panel decides who may use it: each forwarded route is authorised against a Portta permission, the caller's credentials are dropped, and the token and attribution headers (`x-portta-actor`, `x-portta-actor-kind`, `x-portta-source`, `x-portta-user-id`) are added by the panel.
- Project addition is constrained by canonical-root allowlisting.
- Agent hooks deliver runtime events to `/api/modules/taskflow/<prefix>/api/runtime/events` with the same token, carried in the worktree's `control.env` as `PORTTA_FLOW_CONTROL_URL` and `PORTTA_FLOW_CONTROL_TOKEN`.
- Workflow code runs in a restricted VM; agent processes receive an explicit sandbox/approval policy.
- Docker, Git workspace isolation, and provider permissions are independent security layers.

## Persistence and recovery

| State | Location | Purpose |
| --- | --- | --- |
| Host daemon token | `state/host/token` | the credential every caller presents |
| Project registry | `state/host/projects.json` | Projects loaded on boot |
| Runs/Executions | `state/host/taskflow.db` | durable product history and projections |
| workflow journals | `state/host/runs/` | deterministic replay and transcripts |
| user workflows | `state/host/workflows/` | catalog definitions |
| Project config | `<repo>/.portta/` | versioned behavior and local overlay |
| worktree runtime metadata | `<git-common-dir>/portta/` | profiles, env, control endpoint, PR/archive/session state |
| ACP operations/events | `state/host/runtime/supervisor.sqlite` | supervisor replay, output, exit, permission and recovery state |

`state/host` is the daemon's state directory: `PORTTA_HOST_STATE_DIR`, by default `$PORTTA_HOME/state/host` (`~/portta/state/host` for a default installation). See [ADR 0049](../../development/adr/0049-host-state-in-sqlite.md).

Startup reconciliation compares stored active state with workspaces, sessions, and engine handles. Missing active processes become interrupted; recoverable sessions can be reopened or resumed.

## Design invariants

- One source of truth per concern: Git for checkouts, config files for declared Project behavior, database/journal for Runs, multiplexer/provider for live process state.
- Generated environment and runtime artifacts are outputs, never canonical user input.
- Project/worktree lifecycle and workflow orchestration share product services but keep their domain responsibilities distinct.
- Frontend and CLI expose the same user capabilities through the typed backend contract.
- Node.js 24 is the only runtime used by the repository, tests, build, host daemon, and distributed CLI.
