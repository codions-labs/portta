# Develop the database schema

The panel owns durable decisions; `packages/db` owns their schema. The engine is
SQLite, opened in process through `better-sqlite3`
([ADR 0037](adr/0037-sqlite-is-the-panel-database.md)).

## Where the schema lives

`packages/db` owns the schema, the migrations and the client, and holds no
business rule. `packages/server` owns the rules and reaches the tables through
it. The split is what lets a suite run the real migrations against an in-memory
database without starting a panel.

```text
packages/db/
├── drizzle/               0000_current.sql and its journal — generated, never hand-written
├── drizzle.config.ts
└── src/
    ├── schema/            one file per area; the tables, checks, indexes and relations
    │   └── columns.ts     the column shapes every table repeats, declared once
    ├── client.ts          createDb(path) → { db, sql }
    ├── migrate.ts         migrateWithLock(path): BEGIN IMMEDIATE, then the migrator
    ├── seed.ts            seedMinimal(db): the instance row, and nothing else
    └── test-db.ts         createTestDb(): :memory:, migrated
```

## The column shapes, and why they are in one file

SQLite has four storage classes and no date, no boolean, no json and no enum.
Each of those gaps has a bridge with a wrong answer beside it, and a schema that
chose per table would drift — one table storing seconds and the next
milliseconds is the kind of bug that only shows up in a sorted list months
later. `src/schema/columns.ts` makes each choice once:

- **`moment(name)`** is an integer of **milliseconds**, which is what `Date`
  already is. `createdAt`/`updatedAt` default in SQL rather than in the driver,
  so a row written by a migration gets one too, and the default is
  `unixepoch('subsec') * 1000` — plain `unixepoch()` returns seconds, and a
  default three orders of magnitude away from every written value is worse than
  no default at all.
- **`flag(name)`** is an integer 0/1.
- **`json<T>(name)`** is `text({ mode: 'json' })`, parsed by Drizzle. SQLite's
  JSON1 functions still read it, so a query can reach inside one.
- **`id()`** is `INTEGER PRIMARY KEY AUTOINCREMENT`, which never reuses a rowid.

## Vocabularies need two declarations, not one

This is the trap worth knowing before you add a column.

`vocabulary(name, values)` gives TypeScript the union and **nothing else**:
drizzle-kit emits a plain `text` column for it, with no CHECK in the generated
SQL, so a value outside the set would reach the database unchallenged. SQLite has
no enum type that would be a type and a constraint at once.

The constraint is the other half, and every table that declares a vocabulary
lists it beside its indexes:

```ts
export const workSessions = sqliteTable('work_sessions', {
  status: vocabulary('status', SESSION_STATUS_VALUES).notNull().default('active'),
}, (table) => [
  vocabularyCheck('work_sessions', table.status, SESSION_STATUS_VALUES),
])
```

Both halves read the same array from `portta-core`, so they cannot disagree and
adding a value is one edit followed by one migration. `packages/db/tests/schema.test.ts`
asserts that the database refuses a value nothing in `portta-core` names, for
every vocabulary the panel writes — which is what catches a column that declared
the first half and forgot the second.

## Changing the schema

The schema is TypeScript; the SQL is generated from it and committed.

```bash
# 1. edit packages/db/src/schema/*.ts
npm run db:generate --workspace=portta-db   # writes drizzle/NNNN_name.sql and its snapshot
# 2. read the SQL it produced, then commit both
npm run db:check --workspace=portta-db      # fails if the schema and the SQL disagree
```

Nothing in `packages/db/drizzle/` is written by hand. `db:check` runs the
generator and fails if it wanted to write anything, which is the only way to
notice a column added to the schema and never generated; `npm run test:integration`
runs it in a disposable directory.

Read the generated SQL, every time. Two things are easy to miss: a CHECK that
did not appear because the vocabulary's second half is missing, and an
`ALTER TABLE` that SQLite cannot do, which drizzle-kit works around by
recreating the table.

Applied migrations are recorded in `drizzle_migrations`. There is one migration,
`0000_current`, representing the complete schema of this release.

## The migration lock

Startup serialises with `BEGIN IMMEDIATE` over a one-row table
(`__portta_migration_lock`), which takes the database's single write lock at the
start of the transaction rather than at the first write. Two processes starting
together produce one winner and one waiter, and the waiter blocks for
`busy_timeout` rather than failing.

The migrator cannot run *inside* that transaction — Drizzle's SQLite migrator
opens its own, and SQLite has no nested ones — so the sequence is take the lock,
record a timestamp, commit, migrate. The connection is opened and closed by
`migrateWithLock`, so a migration failure never leaves a handle the panel would
then use. A failure there is a failure to boot.

`portta db migrate` applies what is pending without a restart, which is what
makes a newly generated file visible to a panel that is already up. It requests
`POST /api/database/migrate`; it does not open the file from the CLI. In a
checkout, `docker/compose/features/web-dev.yaml` bind-mounts
`packages/db/drizzle` into the panel container, so a file generated on the host
is the file the panel applies. Production reads the migrations packaged with
that release.

## Testing against it

Suites open `:memory:` and apply the same migrations, so the engine under a test
is the engine in production: same driver, same pragmas, same generated SQL. The
CHECK constraints, the closed vocabularies and the cascades are the real ones,
so a query the panel gets wrong fails in the suite rather than in production.

```ts
import { createTestDb } from 'portta-db/testing'

const { db, close } = await createTestDb()
```

Each call owns an independent database, and building the schema from the
migrations takes single-digit milliseconds, so there is no cached image, no
global setup and nothing to keep in step with a schema change. `resetTestDb(db)`
empties every table and restarts the autoincrement counters when one file wants
to reuse one database rather than build several.

See [Testing](testing.md) for current guidance.

## `better-sqlite3` is pinned, and the pin is load-bearing

`better-sqlite3` is fixed at `^12.11.1` in the root manifest and in every
workspace that uses it. Do not remove it from the root as redundant: Drizzle's
driver imports `better-sqlite3` from inside `node_modules/drizzle-orm/`, so the
package has to resolve from the workspace root, and `better-auth` declares it as
an optional peer at `^12.0.0` — a v13 in the tree splits into two copies and the
hoisted one stops being the one the schema was built against. It is a native
dependency, and the image build compiles it.
