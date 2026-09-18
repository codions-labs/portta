# Taskflow

Taskflow is an official Portta module for parallel development with coding
agents. It creates Git worktrees, keeps their terminal sessions alive in tmux
or herdr, runs agents in them, and records the work as durable Runs. It has two
complementary execution surfaces:

- **Direct Sessions** provide interactive, resumable agent work inside a managed workspace.
- **Workflow Runs** execute deterministic JavaScript orchestration across one or more agents.

Both surfaces share the same Projects, workspace policies, Run history,
transcripts, configuration, environment providers and service catalog.

## How it fits into Portta

Taskflow's work needs the host: Git, tmux, agent CLIs and the project
directories. The panel is a container with none of those, so the module runs
inside the Portta host daemon, `portta host serve`, and the panel reaches it
through its authorised module proxy. See
[Run the host daemon](../../product/guides/host-daemon.md) and
[ADR 0047](../../development/adr/0047-host-daemon-and-panel-proxy.md).

The module ships with Portta and is always on; there is nothing to enable:

- `portta host serve` (or the `portta-host` user service) serves Taskflow at
  `/api/modules/taskflow`;
- `portta flow <command>` operates Projects, worktrees and Runs from a terminal;
- the panel shows the Taskflow pages; and
- `portta mcp` and `portta doctor` carry Taskflow tools and checks.

## Start here

1. [Getting started](getting-started.md)
2. [Core concepts](concepts.md)
3. [Dashboard](dashboard.md)
4. [CLI reference](cli.md)
5. [Configuration reference](configuration.md)

## Using Taskflow

- [Projects and workspaces](projects-and-workspaces.md)
- [Runs and sessions](runs-and-sessions.md)
- [Workflow authoring](workflows.md)
- [Integrations](integrations.md)
- [Operations](operations.md)
- [Dev Containers](dev-containers.md)
- [Troubleshooting](troubleshooting.md)

## Developing Taskflow

- [Architecture](architecture.md)
- [Development and testing](development.md)
