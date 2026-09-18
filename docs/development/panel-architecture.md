# Panel architecture

## Architecture

```text
Browser
   |                              http, loopback by default
Panel (Next.js + Hono, one process, one container)
   |-- filtered Docker API, internal control network
Panel socket proxy
   |                              read-only bind of the socket
Docker
Panel -- durable decisions --> SQLite at state/panel/portta.db (opened in process)
Panel -- issues, Taskflow --> host daemon (portta host serve) on the host, with its token
```

The panel application is a single container running a single Node process, and
that process is a dispatcher over four things:

```text
/api/*        the Hono API, including the event stream
upgrade /ws/* WebSocket, authorised before the handshake
/*            Next's handler: the pages, their data, their assets
```

`apps/web/server/main.ts` composes them and `apps/web/server/compose.ts` decides
which is which. One process because the panel is loopback by default with no
proxy in front of it, a session cookie needs a single origin, and one container
is what `portta web up` already starts.

A page is a Server Component: it calls `services.*` from `portta-server`
directly and never fetches the API this same process is serving. What it reads
is handed to the client as `initialData`, so the first paint is the page rather
than a spinner, and the event stream keeps it alive from there. A mutation
always goes through `/api` — the same contract the CLI and MCP use.

It joins two networks: the gateway's shared network (so it can be published, and routed by
Traefik when that is asked for) and its own `internal` control network, where
its socket proxy lives. There is no third network, because the database is a
file the same process opens rather than a server it connects to
([ADR 0037](adr/0037-sqlite-is-the-panel-database.md)).

It never sees the Docker socket, has no Docker CLI, and never receives a project
directory. It bind-mounts only named paths under the installation
(`docker/compose/features/web.yaml`):

| Host path | In the panel | Why |
|---|---|---|
| `.env`, `.env-lock` | read-write | the configuration the Settings page edits, and its lock |
| `.env.example` | read-only | the documented defaults |
| `state/git`, `state/metrics`, `state/environment` | read-only | what `portta repos scan` and the host collector write |
| `state/panel` | read-write | the SQLite database; a directory, so its WAL files stay beside it |
| `state/runner`, `state/access` | read-write | runner requests and access bridge records |
| `state/auth`, `state/ssh`, `state/cloudflared` | read-write | credentials the panel manages, never served directly |
| `config/traefik/dynamic` | read-write | the one place the panel configures Traefik |
| `state/host/token` | read-only | the host daemon's token (`docker/compose/features/panel-host.yaml`) |

Its image carries the generated runtime version as an environment value.

Why a second socket proxy rather than Traefik's: Traefik's is read-only and
must stay that way, while the panel needs the container lifecycle. The two
permission sets are kept apart, and the panel enforces its own allowlist on top
of the proxy's. Its purpose-built client pins Docker Engine API `v1.43`, the
API implemented by the project's minimum supported Docker Engine 24, so a
newer daemon cannot silently change the response contract. See
[ADR 0008](adr/0008-web-panel-socket-proxy.md) and
[ADR 0017](adr/0017-no-docker-sdk.md).

### Technologies

| Layer | Choice |
|---|---|
| Pages | [Next.js 16](https://nextjs.org/) App Router, React 19, Server Components by default |
| Server | Node 24, TypeScript, a custom `http` server that dispatches to Next and Hono |
| API | [Hono](https://hono.dev/), Zod for input validation, OpenAPI generated from the routes |
| UI | Tailwind CSS 4, Radix primitives, TanStack Query, i18next |
| Persistence | SQLite through `better-sqlite3`, Drizzle ORM, generated migrations |
| Live updates | Server-sent events, fed by Docker's own event stream |
| Tests | Vitest (services, API, components, schema), Playwright (end to end) |

There is no Vite in the panel. The one Vite build left in the repository makes
the login page `apps/auth` serves, which is a separate service on a separate
origin and may not import from the panel.

### Where the code lives

```text
apps/web/
├── app/                 routes. (panel)/ has the shell; docs/ is the documentation
├── components/          ui/ primitives, shell/, entities/, issues/, settings/
├── lib/                 api client, queries, live, i18n, docs collector, format
├── messages/            en/*.json, pt-BR/*.json
├── modules/             index.ts (the web registry) and one directory per module (taskflow/)
├── server/              main.ts (the process) and compose.ts (the dispatcher)
├── e2e/                 Playwright specs, the harness, the viewport and screenshot scripts
├── tests/               Vitest projects: logic/, ui/, server/, docs/
└── public/              the favicon, and nothing that needs a request elsewhere
```

### Shell and navigation

The sidebar has two groups. **Development** — Overview and Projects — is the
daily flow; **Infrastructure** — Services, Docker, Network, Access, Gateway —
is the technical perspective over the same host; Settings sits alone at the
end. Each section sets a contextual browser title ending in `Portta`; a
project, issue, repository or environment route refines it with its name. The
title belongs to the route: every page exports `generateMetadata`, so tabs,
bookmarks and history never inherit the previous page's title. The built UI also serves its SVG favicon
locally, with no browser request to a third-party asset.

At `md` and above, the sidebar can collapse from its 224px labelled form to a
48px icon rail, with the `[` key or the control at its foot. The `portta-sidebar`
preference survives reloads when local storage is available and safely defaults
to expanded when it is not. Sections are links, so they open in a new tab like
any link; icons keep tooltips and accessible labels, and the active section
carries `aria-current="page"`. Below `md`, navigation remains the labelled
horizontal strip and the collapse control is hidden.

`⌘K` (`Ctrl+K` elsewhere) opens the command menu: every section, every project
and its issues, the actions of the current page (folding the sidebar) and the
preferences (theme, language). Typing narrows it; Enter runs
the highlighted entry. The visual language of the whole panel is described in
[Design system](design-system.md).

The database stores decisions and identity, not observations. Everything live on
screen (services, URLs, networks, ports, health and bridges) is still read from
Docker at request time, so a container that disappears stops appearing. An issue
is a third case: it belongs to GitHub or Linear, is read at request time and is
never stored ([ADR 0050](adr/0050-work-lives-in-an-external-provider.md)).
The database keeps the gateway instance, project identity and repositories,
typed preferences, accounts, tokens and SSH keys, sessions, activity and audit, and which
environments run for which issue. It is a boot dependency: a panel that cannot
open `state/panel/portta.db` or apply its migrations writes the reason and
exits instead of starting without it. See
[Panel persistence](../product/concepts/persistence.md).

## Out of scope

Not implemented: Kubernetes, deployments, a
Compose editor, a host terminal, image management,
volume management, network management, arbitrary container creation, arbitrary
Traefik configuration, an embedded Traefik dashboard, a tunnel service, or
being a replacement for Portainer or Docker Desktop.

Sessions, activity and issues are described in
[Connect GitHub](../product/guides/github.md),
[Work with issues](../product/guides/issues.md) and
[MCP reference](../product/reference/mcp.md). What is out of scope there: nothing about an issue is stored, so there is no offline reading
and no board; GitHub Projects v2 fields are not read; and a web editor or a file
browser beyond the instruction files is a later step. Local Git stays
host-collected ([ADR 0010](adr/0010-git-collected-on-the-host.md) and
[ADR 0032](adr/0032-portta-development-model.md)).

Sharing is deliberately narrow: one additional hostname per service, with an
expiry, on a network the gateway already answers. It is not authentication for
a project and never becomes an identity layer.

The panel exists to make the gateway pleasant to use day to day, for people and
for agents, and to stop there.

A console inside a running project container is implemented through the narrow
Docker exec boundary in [ADR 0043](adr/0043-container-console-over-docker-exec.md).
It is not a host shell, an arbitrary command endpoint or a general container
management surface.

## Issues through the host daemon

The panel holds no GitHub or Linear credential and calls neither service. An
issue is read and written live by the host daemon (`portta host serve`), which
runs on the host where the operator's tools are signed in:

- **GitHub** through the `gh` CLI session on the host
  ([ADR 0018](adr/0018-github-issues-through-the-gh-cli.md)).
- **Linear** through `LINEAR_API_KEY` in the daemon's environment.

The issue services in `packages/server/src/services/issues/` decide which
repository or Linear team a Project means and project the daemon's answer into
the contract; `host-client.ts` there is the typed client to the daemon's
`/api/forge/*` routes, sending the token from `state/host/token`. Nothing the browser sent reaches the daemon. The panel
stores only the issue reference (`github:owner/repo#113`, `linear:ENG-42`) and
the environments linked to it ([ADR 0050](adr/0050-work-lives-in-an-external-provider.md)).

When the daemon is not running, or no provider is signed in on the host, issue
views say that the provider could not be reached rather than showing an empty
list. See [Run the host daemon](../product/guides/host-daemon.md) and
[Host daemon and module proxy](host-daemon.md).
