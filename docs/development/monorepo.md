# Monorepo layout

Where new code goes, and how a command is added. The decisions behind this
page are [ADR 0014](adr/0014-monorepo-and-the-typescript-cli.md) and
[ADR 0015](adr/0015-node-is-required-on-the-host.md).

The panel lives at `apps/web`, and it composes rather than implements: the
services and the HTTP API are `packages/server`, the shapes they answer with
are `packages/contracts`, and the derivations the host and the CLI share are
`packages/core`. The TypeScript CLI lives in `packages/cli` and is configured
for publication as `@codions/portta`. `npm ci` at the repository root installs
every workspace from one lockfile.

One thing about that lockfile is worth knowing before it costs an afternoon.
Native bindings are optional dependencies chosen by platform, and npm records
`cpu` and `os` for them but not always `libc` — so inside the Alpine image it
can pick the glibc build of a package where the musl one was needed, and the
image build fails on a missing `.node` a long way from anything you changed.
Where the choice matters and can be avoided, it is: the login page's CSS is
minified by esbuild rather than by lightningcss for exactly this reason.

## Map

```text
portta/
├── apps/web/                the panel: Next.js pages and the process that serves them
│   ├── app/                 routes; (panel)/ carries the shell, docs/ the documentation
│   ├── components/          ui/ primitives, shell/, entities/, projects/, settings/
│   ├── lib/                 api client, queries, live, i18n, docs collector
│   ├── messages/            en/*.json, pt-BR/*.json
│   └── server/              main.ts (the process), compose.ts (the dispatcher)
├── apps/auth/               the ForwardAuth service for project hostnames and shares
├── packages/core/           portta-core — shared derivations (private)
├── packages/contracts/      portta-contracts — API schemas, types, openapi.json
├── packages/db/             portta-db — Drizzle schema, migrations, client
├── packages/auth/           portta-auth-core — who is asking, and what they may do
├── packages/server/         portta-server — services, Hono API, background work
├── packages/cli/            @codions/portta — TypeScript CLI
├── bin/portta                Node checkout launcher for the same CLI
├── scripts/                 fixed runner-image entrypoint only
├── docker/
│   ├── compose/              gateway Compose base and overlays
│   └── images/               operational image contexts (apply, toolbox)
├── config/, docs/, tests/, templates/
└── package.json             workspaces: ["apps/*", "packages/*"]
```

| Workspace | Name | Published | Holds |
|---|---|---|---|
| `apps/web` | `portta-web` | no | The pages, the process that serves them, the Dockerfile, and the panel's own tests. No business rule |
| `apps/auth` | `portta-auth` | no | ForwardAuth for project hostnames and shares |
| `packages/core` | `portta-core` | no | Pure derivations: `env`, `config`, `discovery`, `capabilities`, `endpoints`, `inventory`, `apply`, `tunnel`, `password`, `metrics`. No process execution, ever |
| `packages/contracts` | `portta-contracts` | no | The API's Zod schemas and types, and the generated `openapi.json` |
| `packages/db` | `portta-db` | no | The schema, the generated migrations and the client. No business rule |
| `packages/auth` | `portta-auth-core` | no | Better Auth, the security mode, the `Principal`, and the one `authorize` |
| `packages/server` | `portta-server` | no | Every business rule: services, the Hono API, Docker, Traefik, persistence and background work |
| `packages/cli` | `@codions/portta` | yes, by `publish.yaml`; see [Publish the Portta CLI](publish-cli.md) | Commands, formatting, provisioning, and every effect: `process`, `docker`, `host`, `metrics`. Its build bundles `dist/cli.js` and its assets |

`bin/` and `scripts/` stay at the root. They are narrow runtime boundaries, not
alternative command implementations, and are not a workspace.

Runnable example projects are independent repositories under
`PORTTA_PROJECTS_HOME`, conventionally named `portta-demo-*`. The reduced
Compose and manifest inputs under `tests/fixtures/` exist only to keep Portta's
tests self-contained.

## The one rule

> **Local facts come from Core, executed locally. Persistent decisions come
> from the API. Nothing is implemented twice.**

The CLI never writes durable decisions: it asks the API. The panel is the only
writer of the SQLite database at `state/panel/portta.db`
([ADR 0013](adr/0013-what-the-panel-persists.md),
[ADR 0037](adr/0037-sqlite-is-the-panel-database.md)). The operator commands
`portta db status|shell|dump|restore` work on that file from the host
(`shell` and `dump` through `sqlite3`, `restore` only while the panel is
stopped); `portta db migrate` asks the running panel. Docker inventory,
URLs, `.env`, `doctor`, host metrics, `bootstrap` / `up` /
`down` run locally through core.

## Who may import whom

An arrow means "may import". Anything else is a defect, and
`tests/unit/boundaries.test.sh` fails on it in milliseconds.

```mermaid
flowchart LR
    core[packages/core]
    contracts[packages/contracts]
    db[packages/db]
    auth[packages/auth]
    server[packages/server]
    web[apps/web]
    cli[packages/cli]
    fauth[apps/auth]

    contracts --> core
    db --> core
    auth --> core
    auth --> contracts
    auth --> db
    server --> core
    server --> contracts
    server --> db
    server --> auth
    web --> core
    web --> contracts
    web --> db
    web --> auth
    web --> server
    cli --> core
    cli --> contracts
    fauth --> core
```

Read the edges as consequences, not preferences:

- **`packages/core` imports nothing from the monorepo.** It runs on the host,
  in the panel and in the CLI; a dependency would make one of the three
  unbuildable. It has a second entry point, `portta-core/browser`, holding the
  modules with no `node:*` in them so a bundle can use them; `slug` is the
  reason it exists.
- **`packages/contracts` knows only core.** It is what the browser and the CLI
  compile against, so it cannot know a database exists. Its
  OpenAPI generator is a script, not source: it reaches for the server's routes,
  and nothing a consumer loads follows it.
- **`packages/db` holds the shape of the rows and nothing else.** It has no
  business rule to ask `auth` or the services about, which is what lets a suite
  run the real migrations against an in-memory SQLite without starting a panel.
  Its vocabularies are built from the constants in `core`, so a value exists
  once — as a column type *and* as a CHECK, because SQLite has no enum.
- **`packages/auth` answers one question and answers it once.** Who is asking,
  and what they may do. It owns Better Auth, the four roles, the permission
  vocabulary and `authorize`; the API, a Server Component and the event stream
  all read the same `Principal` from it. A second implementation of that
  decision is a second answer, and one of them will be wrong. It knows the
  database because the users are rows, and nothing else in it opens a socket.
- **`packages/server` is the only place with a business rule**, and the only
  one that opens Docker, Traefik or the panel's database. It exports names,
  never `export *` from a service, so `apps/web` cannot reach past what it
  means to offer.
- **`apps/web` composes.** A page calls a service through `lib/server/deps.ts`;
  it never fetches its own API from the server side, because the request would
  leave the process and come back through the same dispatcher to reach code the
  render already has.
- **`packages/cli` never imports the server or the database package.** It
  talks to the panel over HTTP, which keeps "the CLI never writes a durable
  decision" true by construction rather than by care. The `portta db`
  maintenance commands handle the database as a file, never through the
  schema.

## Where new code goes

| You are adding… | It belongs in… |
|---|---|
| A panel page | `apps/web` `app/`, as a Server Component; a Client Component only where there is interaction |
| A React component | `apps/web` `components/` |
| An API route, or the rule behind one | `packages/server` — `src/api/routes/` for the route, `src/services/` for the rule. Never in `apps/web` |
| A Zod schema the API answers with, or a type the CLI compiles against | `packages/contracts` |
| A table, a column, an index or a check | `packages/db` `src/schema/`, then `npm run db:generate --workspace=portta-db`. Never SQL by hand |
| A shared enum or vocabulary both the schema and the CLI need | `packages/core`, named once, with `packages/contracts` deriving its schema from it |
| Parsing `.env`, inventory, Traefik files, the Docker allowlist | `packages/core`, the first time a second consumer needs it |
| A CLI command | `packages/cli` `src/commands/`, colocated `*.test.ts` |
| Host diagnostics, Compose, filesystem provisioning | `packages/cli` calling `packages/core` |
| A host probe: an address, a tool's location, a file mode | `packages/cli` `src/host.ts`, with the verdict it feeds in `packages/core` |
| Host and project resource metrics | Types and normalizers in `packages/core` `metrics.ts`; collection in `packages/cli` `src/metrics/`. The panel only reads the files. See [Host metrics](../product/reference/host-metrics.md) |
| Anything else you were about to write in Bash | `packages/cli`. See [shell scripts](scripts.md): being the interface to `openssl`, `ssh` or `docker run` is not a reason |
| Persistent settings and project overrides | The panel API, never a second database client |
| A document | `docs/product/` or `docs/development/`, classified in `docs/navigation.json`. See [Contribute documentation](documentation.md) |

Do not put panel-only code in `packages/core` "for later". A module enters
core when a second consumer exists, not in anticipation.

## How to add a command

1. Decide the path with the rule above. If the command needs a fact from
   Docker or the host, it runs locally. If it needs a preference stored
   by the panel, it calls the API.
2. If the behaviour already exists in the panel, extract the shared function
   into `packages/core` in the same change that the CLI starts calling it.
3. Put the command module at `packages/cli/src/commands/<name>.ts` with a
   colocated test. Headless-first: plain output, colour only when `stdout` is
   a TTY, `--json` for agents.
4. `node dist/cli.js --help` must still start. A load-time defect is invisible
   to unit tests that never import the entry point.

## Node on the host

The TypeScript CLI needs Node 24+. The npm package is `@codions/portta`; the
installed command is `portta`. Details in [ADR 0015](adr/0015-node-is-required-on-the-host.md).

## AGENTS.md

The root `AGENTS.md` is an index and holds the repository-wide agent testing
policy. A per-directory instruction file exists only where a directory has
rules that are not true of the rest of the repository. Document once; reference
everywhere it is needed. The operating rules for agents on a shared host already live in
[agent-guidelines.md](../agent-guidelines.md).

## Documentation knowledge boundary

Core owns pure documentation compilation and search. Contracts owns API schemas. The server loads the corpus and exposes read endpoints. Next renders the corpus directly; the CLI reads its bundled corpus or an explicitly selected panel. Build tooling reads source files and emits distribution artifacts. No interface keeps an independently edited copy.
