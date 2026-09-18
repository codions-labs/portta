// The column shapes every table repeats, declared once.
//
// SQLite has four storage classes and no date, no boolean, no json and no
// enum. Drizzle bridges all four, but each bridge is a choice with a wrong
// answer beside it, and a schema that made the choice per table would drift:
// one table storing seconds and the next milliseconds is the kind of bug that
// only shows up in a sorted list months later.
//
// So the choices live here:
//
//   * time is an integer of **milliseconds**, which is what `Date` already is.
//     Seconds would round every timestamp the panel writes;
//   * `createdAt`/`updatedAt` default in SQL, not in the driver, so a row
//     inserted by a migration or by `portta db shell` gets one too.
//     `unixepoch('subsec')` is what makes that possible: plain `unixepoch()`
//     returns seconds, and a default three orders of magnitude away from every
//     written value is worse than no default at all;
//   * a boolean is an integer 0/1, which is what SQLite's own `true` is;
//   * a vocabulary is `text` with a CHECK, generated from the same constant in
//     portta-core the CLI and the panel read — the closed set is still enforced
//     by the database, which is the whole point of the old pgEnum;
//   * json is `text`, parsed by Drizzle. SQLite's JSON1 functions read it, so a
//     query can still reach inside one.
//
// See docs/development/adr/0037-sqlite-is-the-panel-database.md.

import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, type CheckBuilder, check, integer, text } from 'drizzle-orm/sqlite-core'

/** A surrogate key. `INTEGER PRIMARY KEY AUTOINCREMENT` never reuses a rowid. */
export const id = () => integer('id').primaryKey({ autoIncrement: true })

/** A foreign key to one of those. Declared by the table that points at it. */
export const ref = (name: string) => integer(name)

/** Milliseconds since the epoch, read back as a `Date`. */
export const moment = (name: string) => integer(name, { mode: 'timestamp_ms' })

/** Milliseconds, from SQLite's own clock. `subsec` is what makes it milliseconds. */
const NOW = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`

export const createdAt = (name = 'created_at') => moment(name).notNull().default(NOW)
export const updatedAt = (name = 'updated_at') => moment(name).notNull().default(NOW)

export const flag = (name: string) => integer(name, { mode: 'boolean' })

/**
 * A closed vocabulary. The values come from portta-core, never from a literal here.
 *
 * This is the column half. It gives TypeScript the union, and nothing else:
 * drizzle-kit emits a plain `text` for it, so a value outside the set would
 * reach the database unchallenged. `vocabularyCheck` is the other half — every
 * table that declares one of these lists the matching check beside its indexes.
 */
export const vocabulary = <T extends string>(name: string, values: readonly T[]) =>
  text(name, { enum: values as unknown as [T, ...T[]] })

/**
 * The constraint half: `column IN (…)`, or null where the column is nullable.
 *
 * Generated from the same array the column was, so the two can never disagree
 * and adding a value is one edit followed by one migration.
 */
export function vocabularyCheck(table: string, column: AnySQLiteColumn, values: readonly string[]): CheckBuilder {
  // `sql.raw`, not a parameter. A bound value becomes `?` in the generated DDL,
  // and `CHECK (x IN (?, ?))` is not a constraint — it is a syntax error waiting
  // for a statement that will never supply it. The values are compile-time
  // constants from portta-core, so quoting them here is safe; the doubling
  // keeps it safe if one ever contains an apostrophe.
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')
  return check(`${table}_${column.name}_check`, sql`${column} IS NULL OR ${column} IN (${sql.raw(list)})`)
}

/** A JSON document, typed on the way out. */
export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()
