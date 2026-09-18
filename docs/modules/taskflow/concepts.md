# Core concepts

## Project

A Project is a Git repository containing `.portta/taskflow.yaml`. The Portta host daemon serves every registered Project at once. Each Project receives a stable URL prefix and owns its configuration, worktrees, workflows, services, and Runs.

Registered Projects are persisted in `projects.json` in the daemon's state directory (`~/portta/state/host/projects.json` for a default installation). `portta flow init` and `portta flow project add` register a repository; a repository the daemon only loads through `PORTTA_FLOW_PROJECT_DIR` is available for that process but is not persisted unless it is added explicitly.

## Workspace

A workspace is the checkout used by a Run or interactive agent. Taskflow supports three strategies:

| Strategy | CLI value | Behavior |
| --- | --- | --- |
| Isolated worktree | `worktree` | Creates or attaches a separate Git worktree and branch. This is the default. |
| New branch | `branch` | Creates a branch and uses the selected checkout policy without a separate managed worktree. |
| Current branch | `current` | Uses the existing project checkout. Branch/base overrides do not apply. |

Only one exclusive writer may own a checkout at a time. Read-only workflows should declare that they do not mutate the repository and may default to the current branch.

## Managed worktree

A managed worktree combines:

- a Git worktree and branch;
- saved Taskflow metadata and runtime environment;
- a selected profile and one or more agent tabs;
- a tmux/herdr session layout;
- allocated service ports; and
- optional Docker, GitHub, and Linear context.

Closing a worktree stops its multiplexer session without deleting the checkout. Archiving hides it from the default list. Removing deletes it. Merging merges it into `workspace.mainBranch` and then removes it.

## Profile

A profile describes how a workspace runs. It selects host or Docker execution, agent safety flags, environment passthrough, mounts, system instructions, and a pane layout. Worktrees remember their selected profile.

## Agent and harness

Claude and Codex are built-in interactive agent kinds. Custom terminal agents can be registered with start and optional resume commands. Workflow providers additionally include OpenCode and Pi.

A **harness** is the session/runtime adapter used by a Direct Session. A **provider** is the model backend used by a workflow `agent()` call. They overlap conceptually but are not interchangeable configuration fields.

## Run

A Run is Taskflow's durable record of requested work. It stores the Project, mode, input, workspace policy, status, timestamps, result/error, and references to its Executions.

The two modes are:

- **Direct** — one interactive agent session with terminal/chat capabilities.
- **Workflow** — a deterministic workflow snapshot that can create many agent executions.

Typical statuses include queued, provisioning, running, waiting for input, completed, failed, interrupted, and cancelled. Available transitions depend on the mode and execution capabilities.

## Execution

An Execution is one concrete unit of work inside a Run. A Direct Run has a root interactive execution. A Workflow Run has workflow and agent executions projected from the engine event stream. Each Execution may expose capabilities, a provider session identifier, checkpoint data, transcript events, timing, usage, and a result.

## Session

A session is the provider or terminal continuity behind an Execution. Direct Sessions may accept input, expose an embedded terminal, be interrupted, and resume when the harness supports those capabilities. A workflow agent call is one-shot; workflow resume replays completed calls from the journal and reruns unfinished work rather than reattaching an in-flight provider turn.

## Workflow

A Workflow is a sandboxed JavaScript file using injected primitives such as `agent()`, `parallel()`, `pipeline()`, `phase()`, and `log()`. Taskflow snapshots its source and metadata at Run creation so a durable Run is not changed by later edits to the catalog file.

## Multiplexer and pane

Taskflow uses tmux by default and can use herdr per machine. A Project maps to a multiplexer session; worktrees map to windows; profile pane definitions map to agent, runtime, shell, or command panes. The browser terminal attaches to this persistent session rather than owning the underlying process.
