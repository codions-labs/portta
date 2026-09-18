import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyProtectionStore,
  hashPassword,
  readProtectionStore,
  setProtection,
  writeProtectionStore,
} from 'portta-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuthApp, safeNext } from './app.ts'
import type { AuthConfig } from './config.ts'
import { LoginLimiter } from './rate-limit.ts'

const secret = 'ab'.repeat(32)
const html = '<!doctype html><html><body><!--PORTTA_AUTH_CONTEXT--><div id="root"></div></body></html>'
let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword('correct')
})

function setup(options: { now?: () => number; limiter?: LoginLimiter; logs?: Record<string, unknown>[] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-auth-'))
  const storePath = join(directory, 'protections.json')
  writeProtectionStore(
    storePath,
    setProtection(emptyProtectionStore(), {
      scope: 'share:a7f3',
      host: 'demo.example.com',
      entryPoints: ['websecure'],
      user: 'reviewer',
      hash: passwordHash,
      label: 'Storefront',
      project: 'demo',
      service: 'web',
      tech: { id: 'node', label: 'Node.js' },
    }),
  )
  const config: AuthConfig = {
    host: '127.0.0.1',
    port: 4180,
    storePath,
    secret,
    uiDir: directory,
    sessionSeconds: 43_200,
  }
  const logs = options.logs ?? []
  const app = createAuthApp({
    config,
    now: options.now,
    limiter: options.limiter,
    log: (value) => logs.push(value),
    loadHtml: () => html,
  })
  return { app, logs, storePath }
}

const forwarded = {
  'x-forwarded-host': 'demo.example.com',
  'x-forwarded-proto': 'https',
  'x-forwarded-for': '203.0.113.4',
}

describe('ForwardAuth app', () => {
  beforeEach(() => {
    /* each test receives an isolated store and limiter */
  })

  it('keeps non-browser clients on a plain 401 without a challenge', async () => {
    const { app } = setup()
    const response = await app.request('/verify', { headers: { ...forwarded, accept: 'application/json' } })
    expect(response.status).toBe(401)
    expect(response.headers.has('www-authenticate')).toBe(false)
  })

  it.each([
    ['a WebSocket upgrade', { upgrade: 'websocket', connection: 'Upgrade', accept: 'text/html' }],
    ['an SSE stream', { accept: 'text/event-stream' }],
  ])('returns 401 rather than redirecting %s', async (_name, headers) => {
    const { app } = setup()
    const response = await app.request('/verify', { headers: { ...forwarded, ...headers } })
    expect(response.status).toBe(401)
    expect(response.headers.has('location')).toBe(false)
    expect(response.headers.has('www-authenticate')).toBe(false)
  })

  // Absolute, on the protected host. Traefik resolves a relative Location from
  // a ForwardAuth response against the *auth service's* own URL, so a relative
  // path reached the browser as `http://portta-auth:4180/...` -- an internal
  // container name nothing outside the Docker network resolves, and the login
  // page was never shown. Found by protecting a real host and following the
  // redirect.
  it('redirects only browser navigation, to the protected host, preserving the path', async () => {
    const { app } = setup()
    const response = await app.request('/verify', {
      headers: {
        ...forwarded,
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'x-forwarded-uri': '/orders/42?tab=items',
      },
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://demo.example.com/__portta/auth/login?next=%2Forders%2F42%3Ftab%3Ditems',
    )
  })

  // The scheme comes from the proxy too: a redirect to https on a plain-HTTP
  // gateway is a login page the browser refuses to load.
  it('follows the scheme the proxy reported', async () => {
    const { app } = setup()
    const response = await app.request('/verify', {
      headers: {
        ...forwarded,
        'x-forwarded-proto': 'http',
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'x-forwarded-uri': '/',
      },
    })
    expect(response.headers.get('location')).toBe('http://demo.example.com/__portta/auth/login?next=%2F')
  })

  // Portta tokens are the panel's, and the panel checks them itself. This
  // process protects project hostnames and shares; a Bearer here is somebody
  // else's credential and means nothing.
  it('has nothing to say about a Bearer token', async () => {
    const { app, storePath } = setup()
    writeProtectionStore(
      storePath,
      setProtection(readProtectionStore(storePath), {
        scope: 'panel',
        host: 'panel.example.com',
        entryPoints: ['websecure'],
        user: 'reviewer',
        hash: passwordHash,
        label: 'Panel',
      }),
    )
    const response = await app.request('/verify?scope=panel', {
      headers: { ...forwarded, 'x-forwarded-host': 'panel.example.com', authorization: 'Bearer ptt_anything' },
    })
    expect(response.status).toBe(401)
    expect(response.headers.has('x-portta-capabilities')).toBe(false)
    expect(response.headers.has('x-portta-token-authenticated')).toBe(false)
  })

  it('renders destination context without embedding a credential', async () => {
    const { app } = setup()
    const response = await app.request('/__portta/auth/login?next=%2Forders', {
      headers: { ...forwarded, 'accept-language': 'pt-BR' },
    })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('Storefront')
    expect(body).toContain('"locale":"pt-BR"')
    expect(body).not.toContain('$portta$scrypt$')
  })

  it('issues a secure host-only session and accepts it on the same scope', async () => {
    let now = 1_700_000_000_000
    const { app, logs } = setup({ now: () => now })
    const response = await app.request('/__portta/auth/login', {
      method: 'POST',
      headers: {
        ...forwarded,
        origin: 'https://demo.example.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'user=reviewer&password=correct&next=%2Forders%3Fpage%3D2',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/orders?page=2')
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('__portta_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).not.toContain('Domain=')
    const cookie = setCookie.split(';')[0] ?? ''
    const verified = await app.request('/verify', { headers: { ...forwarded, cookie } })
    expect(verified.status).toBe(200)
    expect(logs).toEqual([{ event: 'login', scope: 'share:a7f3', address: '203.0.113.4', outcome: 'accepted' }])
    now += 43_201_000
    expect((await app.request('/verify', { headers: { ...forwarded, cookie } })).status).toBe(401)
  })

  it('does not accept a host session on another hostname', async () => {
    const { app } = setup()
    const response = await app.request('/verify', {
      headers: { ...forwarded, 'x-forwarded-host': 'other.example.com', accept: 'text/html' },
    })
    expect(response.status).toBe(401)
  })

  it('refuses requests that did not arrive through the trusted proxy headers', async () => {
    const { app } = setup()
    const response = await app.request('/verify', { headers: { host: 'demo.example.com' } })
    expect(response.status).toBe(401)
  })

  it('rejects a session after its protection epoch changes', async () => {
    const { app, storePath } = setup()
    const login = await app.request('/__portta/auth/login', {
      method: 'POST',
      headers: {
        ...forwarded,
        origin: 'https://demo.example.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'user=reviewer&password=correct&next=%2F',
    })
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const store = readProtectionStore(storePath)
    const protection = store.protections[0]!
    writeProtectionStore(storePath, setProtection(store, { ...protection, hash: await hashPassword('rotated') }))
    expect((await app.request('/verify', { headers: { ...forwarded, cookie } })).status).toBe(401)
  })

  it('does not let an explicit middleware scope bypass the host boundary', async () => {
    const { app } = setup()
    const response = await app.request('/verify?scope=share%3Aa7f3', {
      headers: { ...forwarded, 'x-forwarded-host': 'other.example.com' },
    })
    expect(response.status).toBe(401)
  })

  it('uses one generic failure and logs no submitted values', async () => {
    const logs: Record<string, unknown>[] = []
    const limiter = new LoginLimiter({ wait: async () => undefined })
    const { app } = setup({ limiter, logs })
    const response = await app.request('/__portta/auth/login', {
      method: 'POST',
      headers: {
        ...forwarded,
        origin: 'https://demo.example.com',
        'x-forwarded-for': 'spoofed, 203.0.113.4',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'user=somebody&password=top-secret&next=%2F',
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('"error":true')
    expect(JSON.stringify(logs)).not.toContain('somebody')
    expect(JSON.stringify(logs)).not.toContain('top-secret')
    expect(logs[0]?.address).toBe('203.0.113.4')
  })

  it('rejects cross-origin login and clears logout cookies', async () => {
    const { app } = setup()
    const refused = await app.request('/__portta/auth/login', {
      method: 'POST',
      headers: { ...forwarded, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'user=x&password=x',
    })
    expect(refused.status).toBe(403)
    const logout = await app.request('/__portta/auth/logout', {
      method: 'POST',
      headers: { ...forwarded, origin: 'https://demo.example.com' },
    })
    expect(logout.status).toBe(303)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    const nextRequest = await app.request('/verify', {
      headers: { ...forwarded, accept: 'text/html', 'sec-fetch-mode': 'navigate' },
    })
    expect(nextRequest.status).toBe(302)
  })
})

describe('safe redirects', () => {
  it.each(['https://evil.example', '//evil.example', '/%2F/evil', '/%5cevil', '/ok\r\nLocation: evil'])(
    'rejects %s',
    (value) => {
      expect(safeNext(value)).toBe('/')
    },
  )
  it('keeps an exact local path and query', () => expect(safeNext('/orders/42?tab=items')).toBe('/orders/42?tab=items'))
})
