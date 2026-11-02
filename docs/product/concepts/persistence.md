# Persistence

The administration panel keeps its durable decisions in one SQLite file:
preferences, project metadata, people and access. It is part of the panel, not part of the HTTP gateway, and it
never stores runtime observations as a source of truth.

**There is no database server.** The panel opens the file in its own process
through `better-sqlite3`, so nothing has to be pulled, started, networked or
credentialed before the panel answers. The file lives at
`$PORTTA_HOME/state/panel/portta.db` on the host and is bind-mounted into the
container, which is the whole of the configuration. Migrations run under a lock
before the HTTP listener starts. See
[ADR 0037](../../development/adr/0037-sqlite-is-the-panel-database.md).

> [!NOTE]
> In WAL mode a SQLite database is three files — `portta.db`, `portta.db-wal`
> and `portta.db-shm`. Anything that copies, moves or removes the database moves
> all three; copying only the first is how a backup silently loses the most
> recent writes.

## What is persisted

Decisions:

- one stable gateway instance identity (`instance`);
- **People and access** (`users`, `sessions`, `accounts`, `verifications`,
  `api_keys`, `two_factors`, `project_members`): who may sign in, and which
  Projects a `developer` or `viewer` can see. The tables exist from the first
  migration; the panel starts using them when authentication is turned on;
- **Projects** (`projects`): the product the operator recognises, its slug,
  description and its directory relative to Projects Home; which environments
  it adopted (`project_environments`), and why (`manual`, `label` or `path`);
- **Audit** (`audit_log`): the sensitive writes — who signed in, who changed a
  role, who destroyed an environment — so "who did that" is answerable months
  later. Never a request body, a password, a hash or a token;
- environment identity (`environments`, one row per `COMPOSE_PROJECT_NAME` ever
  seen, with `working_dir` and `config_files` as Docker last recorded them, so
  an environment whose containers are gone can be started again through the
  runner, or forgotten) and the closed catalogue of global, environment and
  service preferences (`settings`, `environment_settings`, `service_settings`).

Fifteen tables in total.

## What is not persisted

Container state, health, ports, networks, URLs, logs and
Traefik status come from their live owners. A stopped container disappears from
the next Docker snapshot; the panel's database is not a stale inventory cache.
`packages/db/tests/schema.test.ts` asserts that no table for any of them exists.

Most of this state is true only of this machine.
[ADR 0016](../../development/adr/0016-state-that-could-be-shared.md) classifies
what could ever be shared between two gateways (project and user decisions) and
what must never be (runtime observations and instance configuration). No
synchronisation is implemented.

## How it is opened

Four pragmas, set on every connection, because SQLite's defaults are tuned for a
library embedded in a phone application rather than for a server with a web
request on one side and a background job on the other:

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Readers do not block the writer, and the writer does not block readers |
| `busy_timeout` | `5000` | A writer that finds the lock held waits instead of failing immediately |
| `foreign_keys` | `ON` | Off by default in SQLite, which would make every reference and cascade decorative |
| `synchronous` | `NORMAL` | The documented safe pairing with WAL: durable against a process crash, at risk only from losing power mid-checkpoint |

That last one is a deliberate trade.

Migrations are serialised across processes by `BEGIN IMMEDIATE` over a one-row
lock table rather than by an advisory lock, because SQLite has no lock that
outlives a statement. Two panels starting together produce one migrator and one
waiter.

## Lifecycle

`portta web down`, `portta down` and subsequent `up` operations leave the file
alone. Checkout only: `portta reset` stops Portta-managed stacks, drops their
volumes, **deletes the panel database files** and starts the checkout again as
if it were new.

The file is operated from the host:

| Command | What it does |
|---|---|
| `portta db status` | The file and its size |
| `portta db shell` | `sqlite3` on the file (needs `sqlite3` on the host) |
| `portta db dump [file]` | A consistent copy, safe while the panel runs (default `portta-<timestamp>.db`) |
| `portta db restore <file>` | Replaces the file; refused while the panel runs (`portta web down` first) and asks for confirmation |
| `portta db migrate` | Asks the running panel to apply pending migrations |
| `portta backup` | Includes a `VACUUM INTO` copy of the database unless `--no-database` |

A panel that cannot open or migrate its database says what is wrong and exits
rather than accepting writes it would lose. A failure *after* boot is a
different thing: the panel keeps serving every Docker-backed page,
`/api/health` and the existing read surfaces, Overview and diagnostics show a
persistence warning, and only an operation that needs stored state returns 503.

See [Back up and restore the panel](../guides/backup-restore.md) for operations
and [Develop the database schema](../../development/database-development.md) for
migrations.
