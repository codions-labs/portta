import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: { NODE_OPTIONS: '--conditions=development' },
    // The Taskflow commands' suites use the `nodeTest` helpers the host installs.
    setupFiles: [
      fileURLToPath(new URL('../host/tests/support/vitest-node-setup.ts', import.meta.url)),
      fileURLToPath(new URL('./test/vitest-setup.ts', import.meta.url)),
    ],
  },
})
