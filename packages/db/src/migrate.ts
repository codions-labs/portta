import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database, { type Database as Sqlite } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Where the generated SQL lives, relative to this module in src/ and in dist/.
 *
 * `import.meta.dirname`, not `new URL('../drizzle', import.meta.url)`. Two
 * reasons, both learnt the hard way: resolving it at module load threw in any
 * test that runs through Vite, where `import.meta.url` is a `/@fs/…` path
 * rather than a file URL; and a bundler reads `new URL(…, import.meta.url)` as
 * an asset reference and tries to resolve `../drizzle` as a module, which it is
 * not — it is a directory of SQL. A plain string is neither.
 */
export function migrationsFolder(): string {
  return join(import.meta.dirname, '..', 'drizzle')
}

/** The table the migrator records applied files in. `drizzle.config.ts` says the same. */
export const MIGRATIONS_TABLE = 'drizzle_migrations'

/**
 * Serialising the migration across processes, without an advisory lock.
 *
 * SQLite has no lock that outlives a statement and no lock a second connection
 * can wait on by name. What it does have is `BEGIN IMMEDIATE`, which takes the database's single write lock at
 * the start of the transaction rather than at the first write — so two
 * processes starting together produce one winner and one waiter, and the waiter
 * blocks for `busy_timeout` rather than failing.
 *
 * The lock is the write transaction itself, held around a one-row table. The
 * migrator cannot run inside it — Drizzle's SQLite migrator opens its own
 * transaction, and SQLite has no nested ones — so the sequence is: take the
 * lock, see whether somebody else already migrated, migrate, release. The row
 * carries a timestamp so a stuck installation can be read rather than guessed
 * at.
 */
const LOCK_TABLE = '__portta_migration_lock'

function withWriteLock<T>(database: Sqlite, run: () => T): T {
  database.exec(`CREATE TABLE IF NOT EXISTS ${LOCK_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL)`)
  // BEGIN IMMEDIATE is the whole mechanism: it acquires the write lock now, so
  // the second process waits here instead of racing through the migrator.
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(`INSERT INTO ${LOCK_TABLE} (id, at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at`)
      .run(Date.now())
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return run()
}

/**
 * Applies pending migrations on a dedicated connection, serialised across
 * processes. The connection is opened and closed here: the process pool is
 * opened afterwards by `createDb`, so a migration failure never leaves a handle
 * the panel would then use.
 */
export function migrateWithLock(path: string, folder: string = migrationsFolder()): void {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path)
  try {
    database.pragma('journal_mode = WAL')
    database.pragma('busy_timeout = 30000')
    database.pragma('foreign_keys = OFF')
    withWriteLock(database, () => {
      migrate(drizzle(database), { migrationsFolder: folder, migrationsTable: MIGRATIONS_TABLE })
    })
  } finally {
    database.close()
  }
}

interface Journal {
  entries: Array<{ idx: number; tag: string }>
}

/** The migrations this build carries, in the order they apply. */
export function migrationTags(folder: string = migrationsFolder()): string[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag)
}

/**
 * Which of them this database has. The migrator's own table records a hash and
 * a timestamp, not a name, and migrations apply in order — so the count is the
 * prefix of the journal that has been applied.
 */
export function appliedMigrations(database: Sqlite, folder: string = migrationsFolder()): string[] {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(MIGRATIONS_TABLE)
  if (!exists) return []
  const row = database.prepare(`SELECT count(*) AS count FROM "${MIGRATIONS_TABLE}"`).get() as { count: number }
  return migrationTags(folder).slice(0, Number(row?.count ?? 0))
}
