import { defineConfig } from 'vitest/config'

// Every suite here opens its own in-memory SQLite over the real migrations, so
// they are
// independent by construction and none of them needs a server. The migrated
// image is built once per run by the global setup; migration tests still run
// the SQL themselves.
export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
