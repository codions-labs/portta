# Integrations

## Agent providers

Taskflow reuses the authentication already configured by local provider tools.

### Claude Code

Install and authenticate the Claude CLI/Agent SDK environment before use. Claude-backed Direct Sessions support native chat history, follow-up input, interruption, and resume when the local session remains available. Workflow calls map sandbox choices to tool permissions and use the provider's structured-output channel.

### Codex

Authenticate the Codex CLI before use. Taskflow talks to `codex app-server` for native conversations and workflow calls. The app-server provides thread/turn streaming, interruption, token usage, file changes, and structured extraction. It uses the CLI's existing ChatGPT/provider login rather than treating `OPENAI_API_KEY` as a replacement for that login.

### OpenCode and Pi

These are workflow providers, not native dashboard chat harnesses. Taskflow invokes their JSONL subprocess interfaces. Because neither can enforce a confined OS sandbox, each call must explicitly use `danger-full-access`. Minimum supported versions are OpenCode 1.16.2 and Pi 0.79.1.

Run `portta flow workflows doctor` to verify availability and versions.

### Agent Client Protocol

Direct and Project-scoped Workflow Runs can opt into ACP with `--transport acp`. Taskflow uses the official ACP SDK, negotiates each adapter's capabilities, and keeps native adapters as the default compatibility path. The ACP agent and commands execute inside the selected host, Dockerfile, Compose, or Dev Container environment; a separate tmux/herdr shell remains available to humans. See the [ACP runtime architecture](architecture.md#agent-client-protocol-runtime).

## GitHub, pull requests, and CI

Install and authenticate `gh` to enable GitHub context:

```bash
gh auth status
```

Taskflow associates a worktree branch with its pull request and displays merge state, review decisions, comments, checks, and CI logs. `integrations.github.linkedRepos` adds related repositories to the same workspace view.

```yaml
integrations:
  github:
    autoRemoveOnMerge: true
    linkedRepos:
      - repo: example/api
        alias: api
        dir: ../api
```

When `autoRemoveOnMerge` is enabled, the reconciliation loop removes eligible managed worktrees after their pull requests merge. Keep it false if post-merge inspection is required.

## Linear

Create a personal Linear API key and expose it to the host daemon:

```bash
printf '%s\n' 'LINEAR_API_KEY=lin_api_...' >> ~/portta/.env
chmod 600 ~/portta/.env
portta host service restart
```

The daemon reads the installation's `.env` (`~/portta/.env` for a default installation), so a restart is enough; `portta host service install` also carries `LINEAR_API_KEY` from the installing shell into the unit. The dashboard can show assigned issues, seed worktrees from issue context, and post normalized conversation exports.

### Manual flows

```bash
portta flow add --from-linear ENG-123
portta flow oneshot --linear ENG-123 --prompt "Resolve the issue"
portta flow linear post feature/example ENG --title "Follow-up work"
```

An issue ID loads that issue and posts the result back to it. A team key creates a new issue when the operation completes.

### Label automation

When `autoCreateWorktrees` is enabled, the watcher recognizes:

- `taskflow` — create a regular worktree from the issue;
- `taskflow_oneshot` — start an autonomous oneshot session and post the conversation back.

If both labels are present, `taskflow_oneshot` wins. An issue is processed once while it remains eligible; remove and re-add the label to retrigger it. `watchTeams` can restrict eligible team keys.

The oneshot pickup writes a structured Linear comment so external automation can observe the branch and start event.

## Docker runtime profiles

Docker profiles isolate worktree processes and configured mounts:

```yaml
profiles:
  sandbox:
    runtime: docker
    image: ghcr.io/codions-labs/portta-sandbox:rolling
    yolo: true
    envPassthrough:
      - ANTHROPIC_API_KEY
    mounts:
      - hostPath: ~/.claude
        guestPath: /root/.claude
        writable: true
```

Taskflow owns container lifecycle and service port forwarding. The image must include the requested agent command on its normal `PATH`. Docker isolation, provider approval policy, and Git worktree isolation are separate controls; enabling one does not imply the others.

The official image is universal and supports Codex, Claude Code, OpenCode, and Pi on `linux/amd64` and `linux/arm64`. `rolling` receives refreshed stable tool releases without changing the structural Sandbox version; pin a full SemVer, immutable `build-*` tag, or digest when repeatability matters. Pull a mutable tag before use to refresh an image already cached locally:

```bash
docker pull ghcr.io/codions-labs/portta-sandbox:rolling
```

The exact installed versions are available inside the image at `/etc/portta-sandbox/manifest.json`.

## Custom agents

Custom agents are configured in `.portta/taskflow.local.yaml` so machine-specific commands need not be committed:

```yaml
agents:
  local-agent:
    label: Local Agent
    startCommand: local-agent start
    resumeCommand: local-agent resume
```

Taskflow validates the command before making the agent available. Custom terminal agents do not automatically gain native chat/history/tool-event capabilities.

## Environment precedence

Environment already set on the daemon or CLI process wins. When a `portta flow` command runs the Taskflow runtime, the launch Project's `.env.local` is loaded before its `.env`, and `$PORTTA_HOME/.env` is loaded last and fills only missing values. Secrets loaded by Taskflow are excluded from the multiplexer server's global environment so one Project does not leak credentials into another.

## Environment diagnostics

Run `portta flow doctor` from a served project to verify the local toolchain, the configured default agent, Codex oneshot auto-review, GitHub and Linear credentials, and Docker profiles. Use `portta flow doctor --json` in automation. Integrations that are not configured are reported as skipped; a configured capability that cannot be used makes the command exit with code 1.

The same checks are available under **Settings → Environment diagnostics** in the dashboard. Machine-wide checks, including whether the host daemon answers and accepts this installation's token, are part of `portta doctor`.

## MCP tools

With the module on, `portta mcp` adds Taskflow tools beside its Portta tools (projects, environments, issues and the rest). They call the panel under `/api/modules/taskflow`, so the panel's authentication and Portta permissions apply to an agent exactly as they do to a person:

| Tool | Purpose |
| --- | --- |
| `list_flow_projects` | list the Projects the host daemon serves |
| `list_worktrees`, `create_worktree`, `remove_worktree` | inspect and manage worktrees |
| `send_to_worktree` | send a prompt to a running worktree agent |
| `list_workflows`, `run_workflow` | inspect the workflow catalog and start a Workflow Run |
| `start_direct_session` | start a Direct Session |
| `list_runs`, `get_run`, `cancel_run`, `resume_run` | inspect and control Runs |
| `respond_permission` | answer an interactive ACP permission request |
| `get_transcript` | read an execution transcript |
| `list_environment_services`, `expose_endpoint` | inspect environment services and expose one |

See [MCP](../../product/reference/mcp.md) for configuring `portta mcp`.

## Live integration certification

External write paths are covered by the protected **Live integration certification** workflow. It creates uniquely named temporary resources and cleans them up after validation. Configure its `live-integration-certification` environment with:

- Secret `PORTTA_FLOW_E2E_GITHUB_TOKEN` and variables `PORTTA_FLOW_E2E_GITHUB_REPO`, `PORTTA_FLOW_E2E_GITHUB_BASE`.
- Secret `LINEAR_API_KEY` and variable `PORTTA_FLOW_E2E_LINEAR_TEAM`.
- Optional variable `PORTTA_FLOW_E2E_DOCKER_IMAGE` (defaults to the official `rolling` image) and `PORTTA_FLOW_E2E_DOCKER_AGENT` (defaults to `codex`).

The workflow is dispatched manually with the targets to certify (`github`, `linear`, `docker`) and sets `PORTTA_FLOW_LIVE_E2E=1` and `PORTTA_FLOW_LIVE_TARGETS` for the certification run. The certification refuses to mutate external systems without the opt-in flag and fails when a selected target is missing its dedicated configuration.
