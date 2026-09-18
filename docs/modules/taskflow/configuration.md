# Configuration reference

## Configuration files

| Path | Scope |
| --- | --- |
| `.portta/taskflow.yaml` | committed Project configuration |
| `.portta/taskflow.local.yaml` | optional machine-specific overlay; do not commit secrets |
| `$PORTTA_HOME/.env` (`~/portta/.env` for a default installation) | the installation's environment: host daemon settings and machine secrets |
| project `.env.local`, `.env` | environment loaded when a `portta flow` command runs the runtime from that Project |

The local overlay may override `multiplexer`, `workspace.worktrees.root`, `workspace.autoPull`, GitHub/Linear toggles, profiles, custom agents, ACP providers, and lifecycle hooks. Profiles, agents and providers are additive; matching names replace the Project definition. When both levels define the same lifecycle hook, the Project command runs first and the local command runs second under `set -e`.

## Complete example

```yaml
name: Example Project
multiplexer: tmux

workspace:
  mainBranch: main
  worktrees:
    root: .portta/worktrees
  defaultAgent: claude
  autoPull:
    enabled: true
    intervalSeconds: 300

agents:
  aider:
    label: Aider
    startCommand: aider
    resumeCommand: aider --restore-chat-history

providers:
  gemini:
    label: Gemini CLI
    command: gemini-acp
    args: []

services:
  # Declare this only when the selected environment is host or a Docker profile.
  - name: API
    portEnv: PORT
    portStart: 3000
    portStep: 10
    urlTemplate: http://127.0.0.1:${PORT}
  - name: Frontend
    portEnv: FRONTEND_PORT
    portStart: 5173
    portStep: 10
    urlTemplate: http://127.0.0.1:${FRONTEND_PORT}

profiles:
  default:
    runtime: host
    environment:
      provider: host # use auto only when services are discovered from the environment
    yolo: false
    systemPrompt: You are working in ${PORTTA_FLOW_WORKTREE_PATH}.
    envPassthrough:
      - GITHUB_TOKEN
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: runtime
        kind: runtime
        split: right
        sizePct: 25
      - id: frontend
        kind: command
        split: bottom
        cwd: worktree
        workingDir: frontend
        command: FRONTEND_PORT=$FRONTEND_PORT npm run dev

  sandbox:
    runtime: docker
    image: ghcr.io/codions-labs/portta-sandbox:rolling
    yolo: true
    envPassthrough:
      - OPENAI_API_KEY
    mounts:
      - hostPath: ~/.codex
        guestPath: /root/.codex
        writable: true
    panes:
      - id: agent
        kind: agent
        focus: true

startupEnvs:
  NODE_ENV: development

integrations:
  github:
    autoRemoveOnMerge: false
    linkedRepos:
      - repo: example/backend
        alias: backend
        dir: ../backend
  linear:
    enabled: true
    autoCreateWorktrees: false
    createTicketOption: true
    watchTeams:
      - ENG

auto_name:
  provider: claude
  model: claude-haiku-4-5
  system_prompt: Return a concise lowercase kebab-case branch name.

lifecycleHooks:
  postCreate: npm install
  preRemove: npm run cleanup

oneshot:
  systemPrompt: Complete, validate, commit, push, and open a pull request without waiting for interactive input.
```

## Top-level fields

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | `Taskflow` | display name |
| `multiplexer` | `tmux` or `herdr` | `tmux` | pane/session backend |
| `workspace` | object | defaults below | Git/worktree policy |
| `profiles` | map | `default` host profile | runtime layouts |
| `agents` | map | empty | custom terminal agents; loaded from local overlay |
| `providers` | map | empty | ACP providers added to, or replacing, the builtin registry |
| `services` | array | empty | explicit host or Docker profile services |
| `exposure` | object | loopback forwards | local endpoint policy |
| `startupEnvs` | map | empty | environment materialized for managed runtimes |
| `integrations` | object | defaults below | GitHub and Linear behavior |
| `auto_name` | object or null | null | branch-name generation |
| `lifecycleHooks` | object | empty | post-create and pre-remove commands |
| `oneshot` | object | built-in autonomous prompt | autonomous session policy |

## Workspace

| Field | Type | Default |
| --- | --- | --- |
| `workspace.mainBranch` | string | current branch at `portta flow init` |
| `workspace.worktrees.root` | string | `.portta/worktrees` |
| `workspace.defaultAgent` | `claude` or `codex` | `claude` |
| `workspace.autoPull.enabled` | boolean | `false` |
| `workspace.autoPull.intervalSeconds` | number, minimum 30 | `300` |

Relative worktree roots are resolved from the Project root. The default internal root is added to `.git/info/exclude` when the first worktree is created, so Taskflow does not modify the shared `.gitignore`. The local overlay can replace the root on one machine without changing the committed file.

## Profiles and panes

Profile fields:

| Field | Type | Notes |
| --- | --- | --- |
| `runtime` | `host` or `docker` | required for explicit profiles |
| `systemPrompt` | string | `${VAR}` placeholders expand from the computed runtime environment |
| `envPassthrough` | string array | selected host variables passed into the agent/container |
| `yolo` | boolean | maps to the provider's non-interactive permission flag |
| `panes` | array | defaults to focused agent plus right-side runtime console |
| `image` | string | required for usable Docker profiles |
| `mounts` | array | Docker volume mappings |
| `environment.provider` | `auto`, `devcontainer`, `compose`, `dockerfile`, `docker`, or `host` | resolved development environment |
| `environment.config` | string | explicit Dev Container, Compose, or Dockerfile configuration path |

## Exposure

```yaml
exposure:
  local:
    provider: loopback # loopback | disabled
    autoExpose: all # all | http | manual
```

`autoExpose: all` creates private loopback endpoints for every discovered container service when its environment becomes ready. `http` limits automatic exposure to HTTP(S); `manual` keeps the **Expose** action and `portta flow environment <branch> expose <service>` workflow. Every endpoint, HTTP included, is a dynamically allocated loopback forward such as `http://127.0.0.1:49152`. A host can plug an endpoint exposure provider that publishes a named URL in front of an HTTP forward; the host daemon configures none yet, so HTTP endpoints report their forward URL. Setting `provider: disabled` prevents Taskflow from creating any endpoint at all, regardless of `autoExpose`. A Runtime pane follows provider logs and then becomes the interactive runtime console; for a host project it owns `profiles.<name>.environment.command` instead.

```yaml
profiles:
  default:
    environment:
      provider: host
      command: npm run dev -- --port "$PORT"
```

Use `environment.command` for the single development process that belongs in the Runtime pane. Keep `kind: command` panes for intentional extra processes only. If that command has a proven configurable port, declare it in `services`; otherwise omit `services` and Taskflow will not display a guessed endpoint.

Pane fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | generated when omitted |
| `kind` | `agent`, `runtime`, `shell`, or `command` | `runtime` follows the resolved environment; command panes require `command` |
| `split` | `right` or `bottom` | placement relative to the previous pane |
| `sizePct` | number | requested split percentage |
| `focus` | boolean | initial focused pane |
| `cwd` | `worktree` or `repo` | base working directory |
| `workingDir` | string | subdirectory for a command pane |
| `command` | string | startup command for `kind: command` |

Mount fields are `hostPath`, optional `guestPath` (defaults to the host path), and optional `writable` (read-only unless true). `~` expands to the user's home. Container images must expose the configured agent commands on the normal `PATH`; login-shell dotfiles are not relied upon.

`dockerfile` and `docker` have different purposes. `dockerfile` is an environment provider selected by `init` or `auto`: Taskflow builds the worktree's Dockerfile and runs the application container without publishing its ports. `docker` is the pane runtime of an explicitly configured Docker profile with `runtime: docker` and `image`; it runs Taskflow panes and agents inside that profile image. It is intentionally not an `init --runtime` choice because a profile image cannot be inferred safely from a repository Dockerfile.

For a managed environment, the standard layout is exactly two panes: `agent` and `runtime`. A profile for the `auto`, Dev Container, Compose, Dockerfile or Docker provider that declares no `runtime` pane gets one appended. Extra panes exist only when explicitly declared; name an intentional extra shell something other than `shell`.

## Custom agents

Custom agent definitions contain:

- `label`: dashboard display name;
- `startCommand`: command used for a new session; and
- `resumeCommand`: optional command used when reopening a saved conversation.

Custom agents are terminal-oriented. Native structured chat/history/interrupt behavior is available only when the corresponding runtime adapter advertises it.

### ACP providers

The ACP transport launches one adapter command per provider id. Four providers are builtin and need no configuration: `codex` (`codex-acp`), `claude-code` (`claude-agent-acp`), `opencode` (`opencode acp`) and `pi` (`pi-acp`). `providers:` adds any other harness that speaks the Agent Client Protocol, or replaces a builtin's command. Each entry contains:

- `command`: the adapter executable, required;
- `args`: optional arguments, an array of strings; and
- `label`: optional display name, defaulting to the id.

Precedence is builtin, then the Project file, then the local overlay; an id declared at a later level replaces the whole entry. An entry without `command` is dropped. The command must exist on the host that runs the Run, or inside the selected container for a managed environment; `portta flow workflows doctor` prints one row per provider with the resolved path. A declared provider is available to workflows on the ACP transport only; the native workers keep running the four builtins.

## Services and ports

Use `services` only when Taskflow starts the process in a host or Docker profile pane and that process accepts a port supplied through an environment variable. Taskflow allocates a collision-free value per managed worktree, exports it as `portEnv` to panes and lifecycle hooks, and shows `urlTemplate` only when it is reachable from the host.

```yaml
services:
  - name: app
    portEnv: PORT
    portStart: 3000
    portStep: 10
    urlTemplate: http://localhost:${PORT}
```

`portStart` is the allocation base and `portStep` defaults to `1`. The pane command must consume the injected variable, for example `PORT=$PORT npm run dev`.

Do not duplicate services declared by a Dev Container, Docker Compose file, or Dockerfile. Those services are discovered from the resolved environment, retain their container-port metadata, and can be exposed through the environment service controls. Use `services` only as an explicit override for a process that cannot be discovered.

## Integrations

`integrations.github.linkedRepos` entries have `repo`, optional `alias`, and optional local `dir`. `autoRemoveOnMerge` defaults to false.

Linear defaults are:

```yaml
integrations:
  linear:
    enabled: true
    autoCreateWorktrees: false
    createTicketOption: false
```

`watchTeams` restricts watched team keys. The team is chosen when creating a ticket.

## Lifecycle hooks and runtime environment

Hooks run with the worktree as `cwd` and receive the same computed environment used by panes, including service ports and:

| Variable | Meaning |
| --- | --- |
| `PORTTA_FLOW_WORKTREE_ID` | stable managed-worktree identity |
| `PORTTA_FLOW_BRANCH` | branch name |
| `PORTTA_FLOW_PROFILE` | selected profile |
| `PORTTA_FLOW_AGENT` | selected agent |
| `PORTTA_FLOW_RUNTIME` | `host` or `docker` |
| `PORTTA_FLOW_WORKTREE_PATH` | checkout path |
| `PORTTA_FLOW_CONTROL_URL` | Project-scoped runtime event endpoint on the host daemon, `http://<bind>:<port>/api/modules/taskflow/<prefix>/api/runtime/events` |
| `PORTTA_FLOW_CONTROL_TOKEN` | the host daemon's token, sent as `Authorization: Bearer` with each event |

Both are written into the worktree's `control.env`. The control URL uses `PORTTA_HOST_BIND`, or `127.0.0.1` when the daemon binds a wildcard address; Docker runtimes rewrite a loopback address to `host.docker.internal`.

Generated runtime files are outputs, not user configuration. Do not edit files under the Git common directory's `portta/` metadata tree.

## Automatic branch names

`auto_name.provider` is `claude` or `codex`. `model` and `system_prompt` are optional. The provider must already be authenticated; API-key-based models use the corresponding provider environment.

## Global data paths

Taskflow's machine-wide state is the host daemon's state directory:
`PORTTA_HOST_STATE_DIR`, by default `state/host` under the installation
(`$PORTTA_HOME/state/host`, `~/portta/state/host` for a default installation):

- `token` — the host daemon's token, created once with mode `0600`;
- `projects.json` — persistent Project registry;
- `taskflow.db` — durable Run/Execution database;
- `runs/` — workflow journals and transcript data;
- `workflows/` — user workflow catalog; and
- `runtime/supervisor.sock`, `runtime/supervisor.sqlite` — the ACP supervisor's socket and operation log.

Machine secrets live in `$PORTTA_HOME/.env`, not in the state directory.

## Module and daemon variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORTTA_HOME` | `~/portta` | the installation directory, as `portta setup` chose it |
| `PORTTA_HOST_BIND` | `127.0.0.1` | address the host daemon listens on |
| `PORTTA_HOST_PORT` | `5111` | port the host daemon listens on |
| `PORTTA_HOST_STATE_DIR` | `$PORTTA_HOME/state/host` | the host daemon's state directory |
| `PORTTA_FLOW_PROJECT_ALLOWLIST` | the user's home directory | colon-separated canonical roots Projects may be added from |
| `PORTTA_FLOW_PROJECT_DIR` | the daemon's working directory | a repository loaded at start without being registered |
| `PORTTA_FLOW_PROJECT_ENV_KEYS` | set by the runtime | keys loaded from a launch Project's env files, kept out of the multiplexer's global environment |
| `PORTTA_FLOW_WORKFLOW_BUILTINS_DIR` | the bundled built-ins | directory of built-in workflows |
| `PORTTA_FLOW_DEBUG` | unset | enable debug logging |
| `PORTTA_FLOW_SUPERVISOR_SOCKET` | `<state dir>/runtime/supervisor.sock` | the ACP supervisor's Unix socket |
| `PORTTA_FLOW_SUPERVISOR_STORE` | `<state dir>/runtime/supervisor.sqlite` | the ACP supervisor's operation log |
| `CODEX_BIN`, `OPENCODE_BIN`, `PI_BIN` | `codex`, `opencode`, `pi` on `PATH` | the provider executables the daemon and the workflow workers start |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | the herdr socket Taskflow connects to, when `multiplexer: herdr` |
| `HERDR_SESSION` | unset | a named herdr session; its socket, `~/.config/herdr/sessions/<name>/herdr.sock`, is used unless `HERDR_SOCKET_PATH` is set |
