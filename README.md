# Portta

Portta is a development gateway and panel for running many Docker Compose projects on one machine at the same time. Every HTTP service gets a predictable hostname instead of a port to remember, databases stay private, and one panel shows what is running, how to reach it and what changed in its repository.

```text
$ portta urls
http://demo-shop-api.localhost             demo-shop            api
http://demo-shop-web.localhost             demo-shop            web
http://demo-site-web.localhost             demo-site            web
```

All of those services listen on the same internal port. None of them publishes a port on the host.

![The Portta Overview: host resources, what needs attention, the Projects, the environments using the host and recent commits](docs/images/auth-disabled-overview.png)

## The problem it solves

Running several projects, branches or agent worktrees side by side on one host breaks down quickly: two stacks want port 3000, nobody remembers which port belongs to what, the machine may have no public address, and checking a change from a phone means exposing something by hand.

## What Portta does

- **Names instead of ports.** One Traefik instance owns ports 80 and 443. HTTP services join a shared Docker network and are routed by a hostname derived from their Compose project and service names.
- **Parallel environments.** Each Compose project name is a namespace, so a branch or a worktree runs next to the main checkout with its own containers, volumes and URLs.
- **Private datastores.** Databases and caches stay on each project's private network. You reach one through a temporary loopback bridge or opt-in TLS routing, never through a published port.
- **Reachable from where you are.** `*.localhost` on a workstation, a domain derived from the host address, your own wildcard domain, Tailscale, or a Cloudflare Tunnel that needs no open port.
- **The work around the code.** The panel groups environments into Projects, shows each repository's branch, commits and instruction files, reads and writes issues live in GitHub or Linear, and shows logs, resources and activity. The CLI and `portta mcp` expose the same model to scripts and coding agents.
- **Taskflow.** Git worktrees, persistent agent sessions and multi-agent workflow runs, driven from the panel or the CLI.

## What Portta is not

Portta is for development, not deployment. It has no release, rollback or production hosting story, and it should not stand between your users and your application.

It is host infrastructure installed once, not a parent Compose project. It does not move your projects, own their volumes or take part in their lifecycle unless you ask it to start, stop or rebuild one.

## Status

Portta is experimental: a proof of concept built for one small team with fairly
specific needs, published in that state. It is opinionated about how a project
is laid out, how environments are named and where work is tracked, and it does
not try to fit every workflow. Expect rough edges: errors and unexpected
behaviour can happen in normal use.

We are still deciding whether this approach is useful or only adds another layer
of bureaucracy and complexity on top of Docker Compose. Several ideas are under
evaluation.

> [!WARNING]
> Breaking changes to the CLI, the configuration and the panel are expected if
> we go ahead with the ideas under evaluation. `v0.x` releases make no
> compatibility promise.

## Requirements

| Requirement | Version |
|---|---|
| Docker Engine with Docker Compose v2 | Engine 24 or newer, Compose 2.24.4 or newer |
| Node.js and npm | Node 24 or newer |
| Operating system | macOS or Linux with a POSIX shell |

Optional: Git (repository metadata and Taskflow), [`gh`](https://cli.github.com) signed in (GitHub issues), `sqlite3` (`portta db shell` and backups), [`just`](https://github.com/casey/just) (checkout shortcuts).

| Verified environment | Evidence |
|---|---|
| macOS 15+ arm64 with OrbStack | Full suite run during development |
| Ubuntu 24.04 amd64 with Docker Engine | Integration in pull-request CI; full end-to-end run on release tags |

Other platforms may work but are not claimed as verified. See the [compatibility reference](docs/product/reference/compatibility.md).

## Install

Portta is an npm package. With Node 24 and Docker present, nothing else is needed:

```bash
npm install -g @codions/portta
portta setup
```

`setup` checks Node, Docker and Compose, asks for one confirmation, then installs the runtime into `~/portta`, prepares `.env`, pulls the pinned images and starts the gateway. Running it again updates the installation. `portta setup --dry-run` reports what it would do without touching the host.

See [Install Portta](docs/product/getting-started/install.md).

## Start

The gateway is running after `setup`. The panel is off until you start it:

```bash
portta status           # the gateway and what it routes
portta web up           # the panel on http://127.0.0.1:8081, no sign-in on loopback
portta doctor           # read-only diagnostics when something is off
```

## Use

Add a Compose project you already have. Portta writes its overlay under its own installation state, never inside your repository:

```bash
portta envs analyze /path/to/project      # what adoption needs; writes nothing
portta adopt /path/to/project             # record the runtime plan
portta runtime up /path/to/project        # start it through the gateway
portta urls                               # the routed hostnames
```

Open the panel to see the environment, its services, logs and resources, and to group repositories into a Project. Follow [Configure your first environment](docs/product/getting-started/first-environment.md) and [Add your first project](docs/product/getting-started/first-project.md).

| Command | What it does |
|---|---|
| `portta up` / `portta down` | Start or stop the gateway. Projects keep running. |
| `portta envs list` / `portta envs show <name>` | Running environments, their services and URLs. |
| `portta access open --project <p> --service <s>` | A temporary loopback bridge to a private service, such as a database. |
| `portta web up --expose local\|tailscale\|vpn\|public\|domain` | How the panel is reached. `public` and `domain` require accounts. |
| `portta config set panel.auth required` | Turn on accounts, roles, Project membership and API tokens. |
| `portta projects list` / `portta issues list` | Projects in the panel, and the issues of a Project. |
| `portta host serve --detach` | The host daemon for issues and Taskflow. |
| `portta mcp` | Serve the Portta tools to a coding agent over stdio. |
| `portta backup` / `portta update` | Back up the installation, or pull the pinned images and recreate. |

Every command accepts `--json`. The complete list is in the [CLI reference](docs/product/reference/cli.md).

## Authentication

By default the panel signs nobody in: on loopback, Tailscale or a VPN every request is the local operator. Set `panel.auth` to `required` for accounts with four roles, Project membership, sessions, personal API tokens and an audit log. Public or domain exposure refuses to start without it. See [Configure authentication](docs/product/guides/authentication.md).

## Agent skills

Portta publishes its working method as agent skills, so Claude Code, Codex, OpenCode, Cursor and other agents follow the same rules you do:

```bash
npx skills add codions-labs/portta -g
```

The skills cover branches and worktrees (`portta-method`), commits, pull requests, issues, resolving an issue end to end, authoring workflows, and adopting a Compose project through the CLI (`portta-adopt-compose`). See [the working agreement](docs/product/concepts/working-agreement.md).

## Develop Portta

```bash
git clone git@github.com:codions-labs/portta.git
cd portta
just dev               # or: ./bin/portta dev
```

This builds the local images, starts the gateway and the panel with hot reloading, and links this checkout's `portta` into `~/.local/bin`. `just dev --demo` also starts the demonstration projects. See [Develop Portta](docs/development/development-setup.md) and [Testing](docs/development/testing.md).

## Documentation

- [Documentation index](docs/README.md), also served by the panel at `/docs` and by `portta docs`
- [Portta architecture](docs/product/concepts/architecture.md), [Networking](docs/product/concepts/networking.md) and [Security](docs/product/concepts/security.md)
- [Choose remote access](docs/product/guides/remote-development.md): Tailscale, Cloudflare Tunnel or a public host
- [Configuration reference](docs/product/reference/configuration.md), [CLI reference](docs/product/reference/cli.md) and [MCP reference](docs/product/reference/mcp.md)
- [Taskflow](docs/modules/taskflow/README.md)
- [Architecture decisions](docs/development/adr/README.md)
- [Changelog](CHANGELOG.md)

## Security

Nothing is exposed by default: the panel is off until you start it and then listens on loopback, datastores stay private, Docker access goes through filtered socket proxies, and public or VPN modes require explicit configuration. Read the [threat model](docs/product/concepts/security.md).

## License

MIT. See [LICENSE](LICENSE).
