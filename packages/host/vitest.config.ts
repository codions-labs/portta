import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Node, and no database: the host daemon keeps its own state in files. The
// Taskflow module's native `node --test` suites (tests/modules, *.node.ts) run
// through `npm run test:node` and `npm run test:workflows` instead; `npm test`
// runs those first, so arguments a runner appends (a reporter) reach Vitest.
export default defineConfig({
  test: {
    name: 'host',
    environment: 'node',
    include: ['tests/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/manual/**', '**/*.node.ts', 'tests/modules/**'],
    setupFiles: [fileURLToPath(new URL('./tests/support/vitest-node-setup.ts', import.meta.url))],
    // Suites that spawn Node on the module's sources resolve workspace packages from source.
    env: { NODE_OPTIONS: '--conditions=development' },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
