import { defineConfig } from 'vitest/config'

// Node, never jsdom: everything here is a service, a route or a repository, and
// a browser environment costs roughly ten times what this one does.
//
// The timeouts are generous because the first test in each file pays for
// opening and migrating its database, and with forty-odd files competing for
// the machine that cost is not the hundred milliseconds it is when a file runs
// alone.
//
// `hookTimeout` matters as much as `testTimeout`: a suite that signs somebody
// in builds its database in `beforeAll`, and with forty-odd files competing for
// the machine that boot passed ten seconds often enough to fail a full run
// while passing every time the file was run alone.
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
