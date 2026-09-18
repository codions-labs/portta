import { defineConfig } from 'drizzle-kit'
import { resolveDatabase } from 'portta-core'

// `migrations` repeats what src/migrate.ts declares. The two have to agree:
// drizzle-kit writes the journal that the programmatic migrator reads, and a
// mismatch means the panel re-applies files the CLI already applied.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './drizzle',
  migrations: { table: 'drizzle_migrations' },
  // Schema generation/checking is offline; `url` only matters to the connected
  // commands (`drizzle-kit studio`, `push`), which no Portta script runs.
  dbCredentials: { url: resolveDatabase(process.env, process.cwd()).path },
  strict: true,
  verbose: true,
})
