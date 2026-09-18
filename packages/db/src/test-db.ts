// A real SQLite, in memory, with the real migrations.
//
// The engine under a test is the engine in production — same driver, same
// pragmas, same generated SQL — so a suite gets the CHECK constraints, the
// closed vocabularies and the cascades rather than a hand-written fake that was
// silently not testing them. Each call owns an independent database.
//
// It is fast enough to need no sharing: building the schema from the migrations
// takes single-digit milliseconds, so there is no cached image, no global setup
// and no tarball to keep in step with a schema change.

import Database, { type Database as Sqlite } from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { MIGRATIONS_TABLE, migrationsFolder } from './migrate.ts'
import * as schema from './schema/index.ts'

export type TestDb = BetterSQLite3Database<typeof schema>

export interface TestDatabase {
  db: TestDb
  /** The driver, for the rare test that asserts on SQL the query builder cannot express. */
  client: Sqlite
  close: () => Promise<void>
}

function createTestDbSync(): TestDatabase {
  const client = new Database(':memory:')
  client.pragma('foreign_keys = ON')
  try {
    migrate(drizzle(client), { migrationsFolder: migrationsFolder(), migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    client.close()
    throw error
  }
  return {
    db: drizzle(client, { schema }),
    client,
    close: async () => {
      client.close()
    },
  }
}

/** Async, because every caller already awaits it and a database may not always be this cheap. */
export async function createTestDb(): Promise<TestDatabase> {
  return createTestDbSync()
}

/**
 * Empties every table the migrations created, and restarts their autoincrement
 * counters, so one database can serve a whole file. The migrator's own table is
 * kept: the schema has not changed, only the rows.
 *
 * Foreign keys are switched off for the duration rather than the tables being
 * sorted into dependency order — the whole database is being emptied, so there
 * is no order in which a cascade would matter.
 */
export async function resetTestDb(db: TestDb): Promise<void> {
  const client = (db as unknown as { $client: Sqlite }).$client
  const rows = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>
  const tables = rows.map((row) => row.name).filter((name) => name !== MIGRATIONS_TABLE)
  if (tables.length === 0) return
  client.pragma('foreign_keys = OFF')
  try {
    client.transaction(() => {
      for (const table of tables) client.prepare(`DELETE FROM "${table}"`).run()
      // Present only once something with AUTOINCREMENT has been inserted into.
      const sequence = client
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
        .get()
      if (sequence) client.prepare('DELETE FROM sqlite_sequence').run()
    })()
  } finally {
    client.pragma('foreign_keys = ON')
  }
}
