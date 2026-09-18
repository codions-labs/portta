import { defineConfig, devices } from '@playwright/test'

// A project is one security mode. `open` is PORTTA_AUTH_MODE=disabled; `auth`
// needs a panel nobody has set up yet; `protected` shares an owner its fixture
// creates; `taskflow` is open, with the module on and a fake host daemon.
// Filtering by file (`-- roles.spec.ts`) still selects one spec.
const PROJECTS = {
  open: ['panel.spec.ts', 'infrastructure.spec.ts'],
  auth: ['auth.spec.ts'],
  protected: ['roles.spec.ts', 'settings.spec.ts'],
  taskflow: ['taskflow.spec.ts'],
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 3,
  retries: process.env.CI ? 1 : 0,
  globalSetup: './e2e/build.mjs',
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { trace: 'retain-on-failure' },
  // Each worker owns its fixture: the SQLite file, the fake Engine and the panel.
  // Specs of one project may share a worker, never one of another project; a
  // retry gets a new worker and cannot inherit users or containers.
  projects: Object.entries(PROJECTS).map(([name, testMatch]) => ({
    name,
    testMatch,
    use: { ...devices['Desktop Chrome'] },
  })),
})
