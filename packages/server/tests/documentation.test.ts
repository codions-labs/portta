import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeApp } from './helpers.ts'

// Exercise the registered routes and authentication middleware with the real corpus.
vi.stubEnv('PORTTA_RUNTIME_DOCS_ROOT', new URL('../../../', import.meta.url).pathname)
afterEach(() => vi.unstubAllEnvs())
describe('documentation API', () => {
  it('rejects unknown documents, bad parameters and internal files', async () => {
    const { app } = makeApp()
    for (const url of [
      '/api/documentation/page?slug=agent-guidelines',
      '/api/documentation/page?slug=install&anchor=missing',
    ])
      expect((await app.request(url)).status).toBe(404)
    for (const url of [
      '/api/documentation/search?q=x&limit=51',
      '/api/documentation/search?q=',
      '/api/documentation/page?slug=../../secrets',
      '/api/documentation?audience=internal',
    ])
      expect((await app.request(url)).status).toBe(400)
  })
  it('requires an authenticated principal through the existing middleware', async () => {
    const { app, principals } = makeApp()
    const resolve = vi.spyOn(principals, 'fromHeaders').mockResolvedValue(null)
    try {
      expect((await app.request('/api/documentation')).status).toBe(401)
    } finally {
      resolve.mockRestore()
    }
  })
  it('respects disabled documentation in read-only mode', async () => {
    const { app } = makeApp({}, { docs: false, readOnly: true })
    for (const path of [
      '/api/documentation',
      '/api/documentation/search?q=dns',
      '/api/documentation/page?slug=install',
    ])
      expect((await app.request(path)).status).toBe(404)
  })
})
