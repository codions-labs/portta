// Persistence: the schema, the migrations and the client. No business rule.
//
// `packages/server` owns every rule; this package owns the shape of the rows
// and how to open a connection to them. That separation is what lets a suite
// run the real migrations against an in-memory SQLite without starting a panel.

export { createDb, type Db, type DbHandle, schema } from './client.ts'
export {
  appliedMigrations,
  MIGRATIONS_TABLE,
  migrateWithLock,
  migrationsFolder,
  migrationTags,
} from './migrate.ts'
export * from './schema/index.ts'
export { seedMinimal } from './seed.ts'
