// What an official module adds to the panel, and that it adds nothing it was not given.

import { Hono } from 'hono'
import { defineModule } from 'portta-core/modules'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/index.ts'
import type { AppDeps } from '../src/deps.ts'
import { moduleDiagnostics, moduleWsRoutes, SERVER_MODULES, type ServerModule } from '../src/modules/index.ts'
import { makeApp, post } from './helpers.ts'

const manifest = defineModule({
  id: 'fake',
  name: 'Fake',
  permissions: { widget: ['read'] },
  activityKinds: [],
})

const fake: ServerModule = {
  manifest,
  routes: () => new Hono().get('/ping', (c) => c.json({ pong: true })),
  ws: () => [
    {
      path: '/ws/modules/fake/echo',
      permission: 'gateway:read',
      scopeOf: async () => undefined,
      handle: () => undefined,
    },
  ],
  doctor: () => [{ id: 'fake', status: 'pass', title: 'Fake', detail: 'reachable', fix: '' }],
}

function appWith(modules: readonly ServerModule[]) {
  const { app: _base, docker, ...deps } = makeApp()
  const composed: AppDeps = { ...deps, client: docker.client, auth: null, modules }
  return { app: createApp(composed), deps: composed }
}

describe('module routes', () => {
  it('answer under /api/modules/<id>, behind the same guards as every route', async () => {
    const { app } = appWith([fake])
    const response = await app.request('/api/modules/fake/ping')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pong: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
    // The origin guard applies to a module's writes too.
    expect(
      (
        await app.request('/api/modules/fake/ping', {
          method: 'POST',
          headers: { origin: 'http://evil.test', host: 'localhost' },
        })
      ).status,
    ).toBe(403)
  })

  it('do not exist while the module is not mounted', async () => {
    const { app } = appWith([])
    expect((await app.request('/api/modules/fake/ping')).status).toBe(404)
    expect((await post(app, '/api/modules/fake/ping')).status).toBe(404)
  })
})

describe('the module registry', () => {
  it('mounts every registered module', () => {
    expect(SERVER_MODULES.map((module) => module.manifest.id)).toEqual(['taskflow'])
  })

  it('refuses a WebSocket route outside the module prefix', () => {
    const { deps } = appWith([])
    expect(moduleWsRoutes(deps, [fake]).map((route) => route.path)).toEqual(['/ws/modules/fake/echo'])
    const stray: ServerModule = {
      manifest,
      ws: () => moduleWsRoutes(deps, [fake]).map((route) => ({ ...route, path: '/ws/environments/:name/logs' })),
    }
    expect(() => moduleWsRoutes(deps, [stray])).toThrow(/outside \/ws\/modules\/fake\//)
  })

  it('appends module checks to the panel diagnostics', async () => {
    const { deps } = appWith([fake])
    expect(await moduleDiagnostics(deps, [fake])).toEqual([
      { id: 'fake', status: 'pass', title: 'Fake', detail: 'reachable', fix: '' },
    ])
    expect(await moduleDiagnostics(deps, [])).toEqual([])
  })
})
