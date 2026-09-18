import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PANEL_SERVICES, panelLoopbackApiUrl, requestPanelMigrate, waitForPanelLoopback, webUrl } from './web.js'

type Context = Parameters<typeof webUrl>[0]

function context(config: Partial<Context['config']>, env: Record<string, string> = {}): Context {
  return {
    root: '/srv/portta',
    env,
    composeFiles: [],
    version: '0.2.0',
    config: {
      webExpose: 'local',
      webPort: 8081,
      webDev: false,
      tlsEnabled: false,
      domain: 'localhost',
      ...config,
    },
  } as unknown as Context
}

describe('where migrations reach the panel', () => {
  it('dials the published API port, never Vite', () => {
    expect(panelLoopbackApiUrl(context({ webDev: true }))).toBe('http://127.0.0.1:8081')
  })

  it('does not treat 0.0.0.0 as a dial address', () => {
    expect(panelLoopbackApiUrl(context({}, { PORTTA_WEB_BIND_ADDRESS: '0.0.0.0' }))).toBe('http://127.0.0.1:8081')
  })
})

describe('where the panel answers', () => {
  it('honours the bind address in both modes', () => {
    const env = { PORTTA_WEB_BIND_ADDRESS: '100.64.0.2' }
    expect(webUrl(context({}, env))).toBe('http://100.64.0.2:8081')
    expect(webUrl(context({ webDev: true }, env))).toBe('http://100.64.0.2:8081')
  })

  it('is the routed hostname when the panel is exposed over the VPN', () => {
    expect(webUrl(context({ webExpose: 'vpn', tlsEnabled: true }))).toBe('https://portta-web.localhost')
  })
})

describe('waiting for the panel before migrate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs migrate only after /api/health answers', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      if (String(url).endsWith('/api/health')) return new Response('{"ok":true}', { status: 200 })
      if (String(url).endsWith('/api/database/migrate')) {
        return new Response(JSON.stringify({ applied: [], migrations: ['0000_current'] }), { status: 200 })
      }
      throw new Error(`unexpected ${url}`)
    })

    await expect(requestPanelMigrate(context({}))).resolves.toEqual({ applied: [], migrations: ['0000_current'] })
    expect(seen[0]).toBe('GET http://127.0.0.1:8081/api/health')
    expect(seen[1]).toBe('POST http://127.0.0.1:8081/api/database/migrate')
  })

  it('sends the demo token when migrate would otherwise be 401', async () => {
    let authorization: string | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/health')) return new Response('{"ok":true}', { status: 200 })
      if (String(url).endsWith('/api/database/migrate')) {
        authorization = new Headers(init?.headers).get('authorization') ?? undefined
        return new Response(JSON.stringify({ applied: [], migrations: ['0000_current'] }), { status: 200 })
      }
      throw new Error(`unexpected ${url}`)
    })

    await expect(requestPanelMigrate(context({}), 'demo-token')).resolves.toEqual({
      applied: [],
      migrations: ['0000_current'],
    })
    expect(authorization).toBe('Bearer demo-token')
  })

  it('times out instead of hanging when the panel never answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(waitForPanelLoopback(context({}), 0)).rejects.toThrow(/the panel is not reachable/)
  })
})

// `docker compose stop svc-a svc-b` is all-or-nothing: one unknown name and it
// refuses the lot, stops nothing, and exits non-zero. `webDown` passes
// `reject: false`, so that refusal is swallowed and the user is told the panel
// stopped while it is still serving.
//
// Reading the compose files is what makes this a test of the two staying in
// step, rather than a copy of the list asserting it equals itself.
describe('the services `web down` names', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))

  /** The top-level keys under `services:`, without taking a YAML dependency. */
  function servicesIn(file: string): string[] {
    const lines = readFileSync(join(root, file), 'utf8').split('\n')
    const start = lines.indexOf('services:')
    if (start < 0) return []
    const names: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break // a new top-level block ends the services one
      const name = /^ {2}([A-Za-z0-9._-]+):\s*$/.exec(line)?.[1]
      if (name) names.push(name)
    }
    return names
  }

  it('all exist in the compose files that define the panel', () => {
    const defined = new Set([
      ...servicesIn('docker/compose/compose.yaml'),
      ...servicesIn('docker/compose/features/web.yaml'),
    ])
    // The parse itself has to be working, or this test passes by finding nothing.
    expect(defined.has('web')).toBe(true)
    expect(PANEL_SERVICES.filter((service) => !defined.has(service))).toEqual([])
  })

  it('does not name a database: the panel database is a SQLite file, not a service', () => {
    expect(PANEL_SERVICES).not.toContain('db')
  })
})
