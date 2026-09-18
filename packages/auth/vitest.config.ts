import { defineConfig } from 'vitest/config'

// Every suite that touches a row opens its own in-memory SQLite over the real
// migrations,
// so what Better Auth writes is checked against the real schema. The migrated
// image is built once per run, not once per file.
export default defineConfig({
  test: {
    name: 'auth-core',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
