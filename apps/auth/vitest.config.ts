import { defineConfig } from 'vitest/config'

// Its own config, because `vite.config.ts` beside it builds the login page and
// sets `root` to `ui/`. Without this file vitest would read that config and
// look for tests in the login page's directory, where there are none.
export default defineConfig({
  test: {
    name: 'auth',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
