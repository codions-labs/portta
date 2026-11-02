import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: { NODE_OPTIONS: '--conditions=development' },
    setupFiles: [fileURLToPath(new URL('./test/vitest-setup.ts', import.meta.url))],
  },
})
