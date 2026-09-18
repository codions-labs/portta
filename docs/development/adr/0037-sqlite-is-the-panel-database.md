# 0037. The panel's database is SQLite, through Drizzle

**Status:** Accepted; see [0013](0013-what-the-panel-persists.md),
[0049](0049-host-state-in-sqlite.md)

## Context

The panel serves one host — its own installation, its own operator, at most
the handful of people [ADR 0038](0038-roles-and-project-access.md) gives
accounts to. There is no second writer, no replica, no connection pool worth
the name, no query that needs a planner, and nothing in the schema that is not
a row somebody wrote from this host. The largest table is bounded activity
([ADR 0032](0032-portta-development-model.md)).

A database server was considered and rejected. It would charge on every axis
an installation is measured by: a container to pull and keep running; a
private network and a named volume; a generated password, and a derived
connection URL that [ADR 0040](0040-installation-environment-contract.md)
would have to promise not to persist under a second name; a managed mode and
an external mode, each with its own failure; and a second dependency that has
to be up, reachable and migrated before the panel opens HTTP, which is the most
common way a fresh installation never reaches its first screen. None of that
buys anything the panel uses.

[ADR 0049](0049-host-state-in-sqlite.md) puts the host daemon's state — which
is written far harder, many times a second, by processes the panel does not
own — in SQLite through `better-sqlite3`. The panel's model is written far
more gently, and the same engine fits it at least as well.

## Decision

> **The panel's durable model is one SQLite file, opened in process through
> `better-sqlite3`, with Drizzle on top. There is no database server, no
> database container, no connection URL and no external mode.**

### One file, named in one place

`packages/core/src/database-config.ts` answers the only question left, which is
*which file*. On the host it is `$PORTTA_HOME/state/panel/portta.db`; in the
container it is `/app/state/panel/portta.db`, and Compose bridges the two by
bind-mounting the host directory and setting
`PORTTA_RUNTIME_DATABASE_FILE`. The panel, the CLI and `drizzle-kit` all resolve
it there rather than each building a path, and neither side derives the other's:
a panel with no variable is a misconfigured container, so it gets the documented
container path instead of guessing from its working directory.

`state/panel/` sits beside `state/host/` and not inside it. The daemon owns its
own SQLite databases there, the two have different processes, lifetimes and
backups, and a shared directory would make "which file is the panel's" a thing
to look up.

In WAL mode a database is three files, so `databaseFiles()` returns all three.
Everything that copies, moves or removes a Portta database moves all three;
copying only the first is how a backup silently loses the most recent writes.

### Four pragmas, and why each one

SQLite's defaults are tuned for a library embedded in a phone application, not
for a long-lived server with a web request on one side and a background job on
the other. `packages/db/src/client.ts` sets, on every connection:

- `journal_mode = WAL`, so readers do not block the writer and the writer does
  not block readers — without it one slow read stalls every write;
- `busy_timeout = 5000`, so a writer that finds the lock held waits rather than
  raising `SQLITE_BUSY` immediately. Five seconds is far longer than any
  statement the panel runs;
- `foreign_keys = ON`, which SQLite leaves off by default and which would
  otherwise make every `references(...)` in the schema decorative, including the
  cascades a Project delete depends on;
- `synchronous = NORMAL`, the documented safe pairing with WAL: durable against
  a process crash, at risk only from losing power mid-checkpoint, which is the
  same trade [ADR 0049](0049-host-state-in-sqlite.md) makes.

### The migration lock is `BEGIN IMMEDIATE`

Two processes starting together must produce one migrator and one waiter.
SQLite has no named lock a second connection can wait on, and none that
outlives a statement. What it has is `BEGIN IMMEDIATE`, which takes the
database's single write lock at the start of the transaction rather than at
the first write.

`packages/db/src/migrate.ts` uses exactly that, over a one-row table
`__portta_migration_lock`: take the write lock, record a timestamp, commit, then
run the migrator. The migrator cannot run *inside* the transaction — Drizzle's
SQLite migrator opens its own, and SQLite has no nested ones — so the lock is
the write transaction, and the second process blocks in it for `busy_timeout`
rather than racing through the migrator. The row carries a timestamp so a stuck
installation can be read rather than guessed at. The migration connection is its
own, opened and closed there, so a failure never leaves a handle the panel would
then use.

### Column conventions

SQLite has four storage classes and no date, no boolean, no json and no enum.
`packages/db/src/schema/columns.ts` makes each of those choices once, because a
schema that made them per table drifts — one table storing seconds and the next
milliseconds is the kind of bug that only surfaces in a sorted list months
later.

- **Time is an integer of milliseconds**, which is what `Date` already is.
  `createdAt`/`updatedAt` default in SQL rather than in the driver, so a row
  written by a migration or by hand gets one too, and the default is
  `unixepoch('subsec') * 1000`: plain `unixepoch()` returns seconds, and a
  default three orders of magnitude away from every written value is worse than
  no default at all.
- **A boolean is an integer** 0/1, which is what SQLite's own `true` is.
- **JSON is `text({ mode: 'json' })`**, parsed by Drizzle. SQLite's JSON1
  functions read it, so a query can still reach inside one.
- **An id is `text`** where it is a UUID, and `integer primaryKey
  autoIncrement` where it is a sequence — `INTEGER PRIMARY KEY AUTOINCREMENT`
  never reuses a rowid.
- **There is no blob column.** Nothing the panel persists is a file.

### A vocabulary is a column *and* a CHECK, and the CHECK is the point

This is the one convention that does not survive being applied casually, and
it is recorded here because the failure mode is silent.

A closed vocabulary is two things at once: a TypeScript union and a database
constraint that refuses anything outside it. Drizzle's `text(name, { enum })`
looks like both and is only the first. **drizzle-kit emits a plain `text`
column for it** — no CHECK appears in the generated SQL — so a value outside
the set would reach the database unchallenged, and every closed vocabulary in
the schema would quietly become free text.

So `columns.ts` splits the job. `vocabulary()` is the column half and gives
TypeScript the union. `vocabularyCheck()` is the constraint half and emits
`CHECK (column IS NULL OR column IN (…))`, generated from the same array in
`portta-core` the column was, so the two cannot disagree and adding a value is
one edit followed by one migration. Every table that declares a vocabulary lists
the matching check beside its indexes. The values are interpolated with
`sql.raw` rather than bound, because a bound value becomes `?` in the generated
DDL and `CHECK (x IN (?, ?))` is not a constraint — it is a syntax error waiting
for a statement that will never supply it.

### One baseline, and tests on the real engine

`packages/db/drizzle/` holds a single generated baseline, `0000_current.sql`,
with twenty tables. `db:generate` and `db:check` share one role: drizzle-kit
writes the journal the programmatic migrator reads, and `drizzle.config.ts`
repeats the migrations table name because the two have to agree.

Tests open `:memory:` and apply the real migrations
(`packages/db/src/test-db.ts`). The engine under a test is therefore the engine
in production — same driver, same pragmas, same generated SQL — so a suite gets
the CHECK constraints, the closed vocabularies and the cascades rather than a
hand-written fake that was silently not testing them. It is fast enough that
each call owns an independent database: single-digit milliseconds per database.

### `better-sqlite3` is pinned to `^12.11.1`, at the root

A trap, recorded so nobody removes the pin as redundant. Drizzle's driver
imports `better-sqlite3` from inside `node_modules/drizzle-orm/`, which means
the package has to resolve from the workspace root, not only from the workspace
that declared it. npm hoists it there — unless it cannot, and `better-auth`
declares `better-sqlite3` as an optional peer at `^12.0.0`, so a v13 in the tree
splits into two copies and the hoisted one is not the one the schema was built
against. The version is therefore pinned to `^12.11.1` in the root manifest
*and* in every workspace that uses it (`packages/db`, `packages/cli`,
`packages/host`), and the root dependency exists for the hoisting rather than
for any import the root makes.

## Consequences

- An installation has no database process. Nothing has to be pulled, started,
  networked, credentialed or waited for before the panel answers.
- Backup and restore are file operations on three files, and a backup is
  something an operator can read with any SQLite tool.
- The panel writes from one process. SQLite makes that load-bearing: a second
  process writing the same file is serialised by `busy_timeout` and nothing
  else, which is adequate for migrations and would not be for a second panel.
- A closed vocabulary is only closed because a test says so. The CHECK is
  generated, not declared by hand, but nothing in the type system notices a
  table that declares `vocabulary()` and forgets `vocabularyCheck()` —
  `packages/db/tests/schema.test.ts` is where that is caught.
- Losing power mid-checkpoint can lose the most recent writes. That is the
  `synchronous = NORMAL` trade, taken deliberately and identically to the host
  daemon's.
- [ADR 0013](0013-what-the-panel-persists.md)'s division stands: the panel
  persists decisions, Docker and Traefik own their own live state, and the
  panel does not copy it in. [ADR 0049](0049-host-state-in-sqlite.md) says
  what the CLI may do with the panel's file, which is the operations on an
  installation and never a write to the model.
