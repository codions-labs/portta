import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database, { type Database as Sqlite } from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema/index.ts'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  db: Db
  sql: Sqlite
}

/**
 * The pragmas a Portta database is opened with, and why each one.
 *
 * SQLite's defaults are tuned for a library embedded in a phone app, not for a
 * long-lived server with a web request on one side and a background job on the
 * other. These four are what make it behave like a server database:
 *
 *   WAL           readers do not block the writer and the writer does not block
 *                 readers. Without it a single slow read stalls every write.
 *   busy_timeout  a writer that finds the lock held waits rather than throwing
 *                 SQLITE_BUSY immediately. Five seconds is far longer than any
 *                 statement the panel runs.
 *   foreign_keys  off by default in SQLite, which would silently make every
 *                 `references(...)` in the schema decorative — including the
 *                 cascades a Project delete depends on.
 *   synchronous   NORMAL is the documented safe pairing with WAL: durable
 *                 against a process crash, and only at risk from losing power
 *                 mid-checkpoint, which is the same trade the host daemon
 *                 already makes (ADR 0049).
 */
function configure(database: Sqlite): void {
  database.pragma('journal_mode = WAL')
  database.pragma('busy_timeout = 5000')
  database.pragma('foreign_keys = ON')
  database.pragma('synchronous = NORMAL')
}

/**
 * One connection per process. Who owns it is the composer's decision
 * (`apps/web/server`), not this module's: a cache in `globalThis` would hide
 * the lifetime of an open file handle from the code that has to close it.
 *
 * `:memory:` is accepted and used by tests; any other value is a path, and its
 * directory is created because a bind-mounted `$PORTTA_HOME/state/panel` may be
 * empty on a first boot.
 */
export function createDb(path: string): DbHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path)
  configure(database)
  return { db: drizzle(database, { schema }), sql: database }
}

export { schema, sql }
