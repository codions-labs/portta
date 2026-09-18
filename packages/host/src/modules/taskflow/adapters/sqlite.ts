import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'

/** Open a SQLite database. The native addon is loaded on first use rather than
 *  imported, so a program that bundles this module starts, and answers `--help`,
 *  on a machine where the addon is not installed. */
export function openDatabase(path: string): BetterSqlite3.Database {
  const Database = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3
  return new Database(path)
}
