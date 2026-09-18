import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// `@/…` is what the app imports itself by; a project does not inherit the root
// `resolve`, so each one is given it.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

// Vitest is Vite, and that is the only Vite in the panel: nothing here builds
// the app, which Next does. `@vitejs/plugin-react` is the JSX transform the
// runner needs.
//
// Separate projects. Components need a DOM; the documentation collector reads the
// repository and must not have one, because a jsdom module URL is `/@fs/…`
// rather than a file and every path it resolves would be wrong.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { '@': root } },
        test: { name: 'logic', environment: 'node', include: ['tests/logic/**/*.test.ts'] },
      },
      {
        resolve: {
          alias: { '@': root },
        },
        test: {
          name: 'docs',
          environment: 'node',
          include: ['tests/docs/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { '@': root },
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/ui/setup.ts'],
          include: ['tests/ui/**/*.test.tsx', 'tests/ui/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: { '@': root },
        },
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
    ],
  },
})
