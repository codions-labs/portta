import { test as base, expect } from '@playwright/test'
import { startPanel } from './resources.mjs'
import { startTaskflowHost } from './taskflow-host.mjs'

type Panel = Awaited<ReturnType<typeof startPanel>>
const OWNER = { name: 'Ada Lovelace', email: 'ada@example.test', password: 'an-end-to-end-password' }

// biome-ignore lint/suspicious/noConfusingVoidType: a Playwright fixture with no value is typed void, as the Playwright API documents
export const test = base.extend<{ engineURL: string; ownerReady: void }, { panel: Panel }>({
  panel: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the destructuring pattern to know which fixtures a function needs
    async ({}, use, info) => {
      const protectedPanel = ['auth', 'protected'].includes(info.project.name)
      // The Taskflow project runs its panel against a fake host daemon.
      const host = info.project.name === 'taskflow' ? await startTaskflowHost() : null
      const env = host ? { PORTTA_HOST_URL: host.url, PORTTA_RUNTIME_HOST_TOKEN_FILE: host.tokenFile } : {}
      const panel = await startPanel({ mode: protectedPanel ? 'required' : 'disabled', env })
      try {
        await use(panel)
      } finally {
        await panel.close()
        await host?.close()
      }
    },
    { scope: 'worker', timeout: 90_000 },
  ],
  baseURL: async ({ panel }, use) => {
    await use(panel.url)
  },
  engineURL: async ({ panel }, use) => {
    await use(panel.engineURL)
  },
  ownerReady: [
    async ({ playwright, panel }, use, info) => {
      // Bootstrap itself is exercised through the UI. Every other protected
      // scenario can run alone, including a name-filtered wrong-password test.
      if (
        info.project.name === 'protected' ||
        (info.project.name === 'auth' && info.title === 'says nothing useful about a password that is wrong')
      ) {
        const request = await playwright.request.newContext({ baseURL: panel.url })
        try {
          const response = await request.get('/api/auth/status')
          expect(response.ok()).toBe(true)
          if ((await response.json()).setupRequired) {
            const setup = await request.post('/api/auth/setup', { data: OWNER })
            expect(setup.status()).toBe(201)
          }
        } finally {
          await request.dispose()
        }
      }
      await use()
    },
    { auto: true },
  ],
})
export { expect }
