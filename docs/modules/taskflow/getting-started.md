# Getting started

## Requirements

Taskflow runs inside Portta's CLI and host daemon, so it needs **Node.js 24 or
newer** like the rest of Portta.

| Tool | Required | Purpose |
| --- | --- | --- |
| Node.js 24+ | yes | CLI, host daemon, and embedded workflow engine |
| Git | yes | repository and worktree management |
| Python 3 | yes | managed agent hook/event helper |
| tmux | yes, unless herdr is used | persistent terminal panes |
| herdr | no | machine-local multiplexer alternative after initialization |
| Claude Code/Codex/OpenCode/Pi | as used | agent harnesses and workflow providers |
| `gh` | optional | pull request, CI, and review context |
| Docker | optional | Docker runtime profiles and container environments |
| Dev Containers CLI 0.89.0 | optional | the Dev Container environment provider |

Install tmux and Python with your platform package manager. Authenticate every
provider CLI you intend to use before starting a real session or workflow.
`portta doctor` reports each of these tools.

Taskflow ships with Portta; there is nothing separate to install or enable.
`portta flow --help` works as soon as Portta is installed, and a panel that is
on shows the Taskflow pages and reaches the daemon on its own; see
[Run the host daemon](../../product/guides/host-daemon.md#let-the-panel-reach-it).

## Start the host daemon

Every Project, worktree and Run is served by one Portta host daemon per machine:

```bash
portta host serve            # foreground; Ctrl-C stops it
portta host serve --detach   # background, logging to state/host/daemon.log
```

It listens on `127.0.0.1:5111` unless `PORTTA_HOST_BIND` or `PORTTA_HOST_PORT`
say otherwise. The first start creates the daemon's token at
`state/host/token` in the installation; `portta flow` commands read it from
there, so there is nothing to copy.

To keep the daemon running across logouts and reboots, install it as a user
service instead:

```bash
portta host service install
```

See [Operations](operations.md) for the service, the token and binding.

## Initialize a project

Run `init` from any directory inside a Git repository:

```bash
cd /path/to/project
portta flow init
```

The setup checks the required tools, detects Git, Dev Container, Compose, Dockerfile and package metadata, creates `.portta/taskflow.yaml` at the repository root, and registers the Project with the host daemon. The current checkout branch becomes the default base for new worktrees. A valid Dev Container takes precedence over Compose, then Dockerfile. If none is found, interactive `init` offers Analyze with Claude or Codex to prepare a host command such as `npm run dev`; `portta flow init --analyze=auto` performs that fallback without a prompt for automation. It does not guess a framework port. Use `--runtime=devcontainer|compose|dockerfile|host` to override detection. Machine-specific overrides belong in `.portta/taskflow.local.yaml`.

## Open the dashboard

The dashboard is the Taskflow section of the Portta panel. Start the panel with
`portta web up` if it is not running, and open Taskflow from it. The panel
checks your Portta permissions and forwards each request to the daemon with the
daemon's token; the browser never holds that token. See [Dashboard](dashboard.md).

## Create your first worktree

Use the dashboard creation dialog or the equivalent CLI command:

```bash
portta flow add feature/first-task --prompt "Implement the first task"
```

Taskflow creates the branch and worktree, allocates configured host-service ports, materializes runtime environment files, runs `postCreate`, and starts the configured multiplexer panes. The default layout is exactly two panes: Agent and Runtime. The Runtime pane runs `environment.command` for a host project, or follows and controls the selected container provider. Compose, Dev Container, and Dockerfile services receive private local endpoints after discovery. Add `--detach` to create it without changing the focused terminal.

List and manage it with:

```bash
portta flow list
portta flow close feature/first-task
portta flow open feature/first-task
portta flow merge feature/first-task
```

## Start a Direct Session

A Direct Session is represented as a durable Run while retaining an interactive agent session:

```bash
portta flow run direct \
  --harness claude \
  --input "Inspect the authentication flow"
```

Use `--workspace worktree`, `--workspace branch`, or `--workspace current` to choose its workspace strategy. The default is an isolated worktree.

## Run a workflow

```bash
portta flow workflows list
portta flow run workflow deep-research \
  --input "How does request authentication work?" \
  --workspace current
```

Workflow Runs are visible in the dashboard and through `portta flow runs list`. Project workflows live in `.portta/workflows/`; user workflows live in `state/host/workflows/` under the installation (`~/portta/state/host/workflows/` for a default installation).

## Serve more Projects

One daemon hosts every registered Project:

```bash
portta flow project add /path/to/another/project
portta flow project ls
```

## Next steps

- Learn the terminology in [Core concepts](concepts.md).
- Customize panes, agents, services, and integrations in [Configuration](configuration.md).
- Learn the full lifecycle in [Projects and workspaces](projects-and-workspaces.md).
- Author multi-agent programs with [Workflows](workflows.md).
