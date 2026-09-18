# Projects and workspaces

## One daemon, many Projects

Taskflow runs once per machine, inside the Portta host daemon. The daemon loads every repository in `projects.json` in its state directory (`~/portta/state/host/projects.json` for a default installation), gives each a URL prefix, and reloads routes when Projects are added or removed.

```bash
portta flow project add ~/code/api
portta flow project add ~/code/web
portta flow project ls
```

A repository named by `PORTTA_FLOW_PROJECT_DIR` in the daemon's environment is included for that process when it has `.portta/taskflow.yaml`. Register it if it must survive restart.

## Initialization and allowlist

A Project is valid when its canonical Git root contains `.portta/taskflow.yaml`. `portta flow init` creates a deterministic starter from Git, Dev Container, Compose, Dockerfile and package metadata. If no container runtime is found, it offers restricted agent-assisted Analyze to prepare an explicit host runtime command rather than guessing one. `--analyze=auto` performs that fallback non-interactively with the system default agent, while `--analyze=claude` or `--analyze=codex` requests a specific agent. Its default worktree base is the current checkout branch, not blindly the remote default branch; creation dialogs and CLI/Run commands can override it. Adding an uninitialized repository from the dashboard can run the same authoring flow asynchronously, but does not start work.

`PORTTA_FLOW_PROJECT_ALLOWLIST` restricts which canonical roots may be added. The value is colon-separated and defaults to the user's home directory. Symlink resolution and Git-root normalization occur before the check. `portta flow init` also registers its Git root: it registers the Project with the running host daemon through its API, or persists the root in `projects.json` in the state directory when no daemon answers.

## Worktree lifecycle

### Create

Taskflow validates the branch, chooses a base, creates or attaches the Git worktree, writes canonical metadata, allocates configured host-service ports, runs `postCreate`, starts the pane layout, and reconciles the Project snapshot. A selected Dev Container, Compose, or Dockerfile provider is materialized for a new session and is isolated by worktree; the Compose project name and Dockerfile container name are deterministic per environment. Managed sessions use an Agent pane plus a Runtime pane and create private local endpoints according to `exposure.local.autoExpose`.

Creation is transactional where practical: failures before a usable result trigger cleanup of created resources. Existing branches must be requested explicitly with `--existing`.

### Open and close

`open` rebuilds the saved profile layout, resumes supported agent conversations, and starts the selected environment when it is ready to be trusted. `close` removes the live multiplexer window but retains the checkout, metadata, branch, conversation state, and the environment record.

Taskflow periodically stores the non-empty set of open sessions. `portta flow restore` recreates those sessions after a restart.

### Archive and label

Archiving is a presentation state; it does not close or remove the worktree. Labels are user-facing names independent of the Git branch.

### Change profile or multiplexer

Changing a profile restarts an open layout with the new runtime, panes, and commands. Provider conversations resume when supported, but arbitrary processes and terminal scrollback do not.

`portta flow multiplexer tmux|herdr` is a machine-local Project override. Switching performs the same close/reopen cycle for all currently open worktrees.

### Merge, remove, and prune

`merge` merges the worktree branch into `workspace.mainBranch`, then removes its runtime and checkout. Conflicts stop the operation for manual resolution; Taskflow does not silently discard dirty or conflicting state.

`remove` deletes the checkout **and its branch**, so anything living only there is gone. It is refused when the worktree holds uncommitted changes, or commits that are neither on the main branch nor on an origin branch; `--force` (`?force=true` on the API) discards them on purpose, and the panel names what it found before asking. `prune` targets closed managed worktrees in the current Project, asks for confirmation, and leaves behind — reporting each one — any worktree holding work that exists nowhere else.

## Workspace strategies for Runs

Runs provision one of three workspace strategies:

### Isolated worktree

Creates a Taskflow-managed branch/worktree for the Run. Use this for writing work, parallel isolation, and workflows that may change repository files.

```bash
portta flow run workflow code-review --workspace worktree --branch review/auth
```

### New branch

Creates a new branch under the Run's checkout policy without requesting a separate worktree abstraction. Use it only when the selected execution mode supports that ownership model.

### Current branch

Uses the Project checkout directly. It is appropriate for read-only workflows and deliberate in-place work. Dirty workspaces, detached HEADs, and competing exclusive writers are rejected when they make the requested policy unsafe.

```bash
portta flow run workflow deep-research --workspace current --input "Map the API"
```

## Run-level and child worktrees

The Run workspace is owned by Taskflow for the Run lifetime. Workflow code must not create or delete it manually.

Inside a Workflow Run, `agent(..., { worktree: true })` requests an additional child lease for an agent that writes in parallel. Use child worktrees only when concurrent mutations would conflict. Read-only analysis should share the Run workspace.

## Pane layout

A Project multiplexer session contains one window per open worktree. Pane declarations are applied in order. An `agent` pane launches the selected agent; a `runtime` pane follows the resolved environment and becomes its interactive console; a `shell` pane opens an interactive shell; a `command` pane runs its configured command. Managed environments use `agent` + `runtime` by default.

The browser terminal attaches through a PTY bridge to the multiplexer. The daemon can reconnect to a still-running session after the browser disconnects.

## herdr

Set herdr locally without changing the committed Project default:

```bash
portta flow multiplexer herdr
```

Tradeoffs compared with tmux:

- Taskflow maps Projects, worktrees, and panes onto herdr's session model rather than tmux windows.
- Existing layouts are recreated during a switch; running commands and scrollback are not transferable.
- The dashboard checks adapter capabilities before exposing terminal-dependent actions.
- If a herdr session cannot be resolved unambiguously, specify or recreate it through Taskflow rather than attaching to an arbitrary session.

Use `portta flow multiplexer tmux` to return to the default adapter.

## Metadata and recovery

Canonical worktree runtime data is stored under the shared Git directory's `portta/` tree rather than inside the checkout. It includes metadata, environment, control endpoint, PR cache, archive state, and the open-session snapshot.

Reconciliation combines Git worktrees, Taskflow metadata, multiplexer state, service probes, and integration data into the Project snapshot. Generated runtime files are outputs; repair configuration or reopen the worktree instead of editing them by hand.

Existing worktrees are represented as a detected environment without starting containers. A missing Dev Container, Compose manifest, or Dockerfile in that worktree is shown as a failed environment with its diagnostic, rather than hiding runtime controls.
