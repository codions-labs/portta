import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyProtectionStore,
  hashPassword,
  issueEntryState,
  issueSiteEntry,
  readProtectionStore,
  removeProtection,
  setDefaultCrawlers,
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

function setup(
  options: { now?: () => number; limiter?: LoginLimiter; logs?: Record<string, unknown>[]; panelUrl?: string } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-auth-'))
  const storePath = join(directory, 'protections.json')
  writeProtectionStore(
    storePath,
    setProtection(emptyProtectionStore(), {
      scope: 'share:a7f3',
      host: 'demo.example.com',
      entryPoints: ['websecure'],
      mode: 'protected',
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
    panelUrl: options.panelUrl ?? '',
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

function contextOf(body: string): Record<string, unknown> {
  const match = /<script id="portta-auth-context" type="application\/json">(.*?)<\/script>/s.exec(body)
  return JSON.parse(match?.[1] ?? '{}') as Record<string, unknown>
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

  describe('what a hostname is decided to be', () => {
    const openHeaders = { ...forwarded, 'x-forwarded-host': 'api.example.com', accept: 'application/json' }

    function withPublicHost() {
      const instance = setup()
      writeProtectionStore(
        instance.storePath,
        setProtection(readProtectionStore(instance.storePath), {
          scope: 'host:api.example.com',
          host: 'api.example.com',
          entryPoints: ['websecure'],
          mode: 'public',
          label: 'api',
        }),
      )
      return instance
    }

    it('asks a protected host for its credential', async () => {
      const { app } = withPublicHost()
      const response = await app.request('/verify', { headers: { ...forwarded, accept: 'application/json' } })
      expect(response.status).toBe(401)
    })

    it('lets a public host through at once, with no login and no session', async () => {
      const { app } = withPublicHost()
      expect((await app.request('/verify', { headers: openHeaders })).status).toBe(200)
      expect((await app.request('/verify', { method: 'POST', headers: openHeaders })).status).toBe(200)
    })

    it('refuses a host nobody decided about, so forgetting leaves it closed', async () => {
      const { app } = withPublicHost()
      const response = await app.request('/verify', {
        headers: { ...openHeaders, 'x-forwarded-host': 'undecided.example.com' },
      })
      expect(response.status).toBe(401)
    })

    it('has no login page for a public host', async () => {
      const { app } = withPublicHost()
      const response = await app.request('/__portta/auth/login', { headers: { 'x-forwarded-host': 'api.example.com' } })
      expect(response.status).toBe(404)
    })

    it('closes a host again the moment its record is removed', async () => {
      const { app, storePath } = withPublicHost()
      expect((await app.request('/verify', { headers: openHeaders })).status).toBe(200)
      writeProtectionStore(storePath, removeProtection(readProtectionStore(storePath), 'host:api.example.com'))
      expect((await app.request('/verify', { headers: openHeaders })).status).toBe(401)
    })
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
        mode: 'protected',
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

  describe('a host that asks for the password alone', () => {
    function passwordOnly() {
      const instance = setup()
      const store = readProtectionStore(instance.storePath)
      const { user: _user, ...bare } = store.protections[0]!
      writeProtectionStore(instance.storePath, { ...store, protections: [{ ...bare }] })
      return instance
    }
    const post = (app: ReturnType<typeof setup>['app'], body: string) =>
      app.request('/__portta/auth/login', {
        method: 'POST',
        headers: {
          ...forwarded,
          origin: 'https://demo.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      })

    it('lets the password in with no username, as nobody in particular', async () => {
      const { app } = passwordOnly()
      const response = await post(app, 'password=correct&next=%2F')
      expect(response.status).toBe(303)
      const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
      const verified = await app.request('/verify', { headers: { ...forwarded, cookie } })
      expect(verified.status).toBe(200)
      expect(verified.headers.get('x-forwarded-user')).toBe('guest')
    })

    it('still refuses a wrong password, and tells the page there is no username to ask for', async () => {
      const { app } = passwordOnly()
      const response = await post(app, 'password=wrong&next=%2F')
      expect(response.status).toBe(401)
      expect(contextOf(await response.text()).protection).toMatchObject({ passwordOnly: true })
    })

    it('keeps asking for the username where the record has one', async () => {
      const { app } = setup()
      expect((await post(app, 'password=correct&next=%2F')).status).toBe(401)
      expect((await post(app, 'user=reviewer&password=correct&next=%2F')).status).toBe(303)
    })
  })

  it('tells the page how long the lock lasts, once too many were wrong', async () => {
    const limiter = new LoginLimiter({ wait: async () => undefined })
    const { app } = setup({ limiter })
    const attempt = () =>
      app.request('/__portta/auth/login', {
        method: 'POST',
        headers: {
          ...forwarded,
          origin: 'https://demo.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'user=reviewer&password=wrong&next=%2F',
      })
    let last = await attempt()
    for (let count = 1; count < 5; count += 1) last = await attempt()
    expect(last.status).toBe(429)
    expect(contextOf(await last.text())).toMatchObject({ state: 'login', error: true, lockedMinutes: 15 })
    expect(contextOf(await (await attempt()).text()).lockedMinutes).toBe(15)
  })

  it('does not tell a wrong password it was locked', async () => {
    const { app } = setup({ limiter: new LoginLimiter({ wait: async () => undefined }) })
    const response = await app.request('/__portta/auth/login', {
      method: 'POST',
      headers: {
        ...forwarded,
        origin: 'https://demo.example.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'user=reviewer&password=wrong&next=%2F',
    })
    expect(response.status).toBe(401)
    expect(contextOf(await response.text())).not.toHaveProperty('lockedMinutes')
  })

  it('answers an address nobody protects with a page that explains, and says nothing about it', async () => {
    const { app } = setup()
    const response = await app.request('/__portta/auth/login', {
      headers: { ...forwarded, 'x-forwarded-host': 'ended.example.com', 'accept-language': 'pt-BR' },
    })
    expect(response.status).toBe(404)
    const context = contextOf(await response.text())
    expect(context).toMatchObject({ state: 'unavailable', locale: 'pt-BR' })
    expect(context).not.toHaveProperty('protection')
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

describe('a session of the panel', () => {
  const PANEL = 'https://panel.example.com'
  const STATE = issueEntryState('demo.example.com', 'https', secret)
  const entry = (overrides: Partial<Parameters<typeof issueSiteEntry>[0]> = {}, at = Date.now()) =>
    issueSiteEntry(
      { host: 'demo.example.com', scope: 'share:a7f3', epoch: 1, user: 'ada@example.test', state: STATE, ...overrides },
      secret,
      Math.floor(at / 1000),
    )
  const arrive = (
    app: ReturnType<typeof setup>['app'],
    token: string,
    next = '/orders',
    cookie = `__Host-portta_entry=${STATE}`,
  ) =>
    app.request(`/__portta/auth/panel?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`, {
      headers: { ...forwarded, ...(cookie ? { cookie } : {}) },
    })

  it('opens the site once, as the person the panel named', async () => {
    const { app } = setup({ panelUrl: PANEL })
    const token = entry()
    const response = await arrive(app, token)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/orders')
    const cookie = /__portta_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? ''
    const verified = await app.request('/verify', { headers: { ...forwarded, cookie } })
    expect(verified.status).toBe(200)
    expect(verified.headers.get('x-forwarded-user')).toBe('ada@example.test')

    const again = await arrive(app, token)
    expect(again.status).toBe(302)
    expect(again.headers.get('location')).toContain('panel=expired')
  })

  it.each([
    ['another host', { host: 'other.example.com' }],
    ['another decision', { scope: 'share:zzzz' }],
    ['a password that has been rotated since', { epoch: 2 }],
  ])('refuses a token made for %s', async (_name, overrides) => {
    const { app } = setup({ panelUrl: PANEL })
    const response = await arrive(app, entry(overrides))
    expect(response.status).toBe(302)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('lasts an hour, not as long as a password session, so a right the panel takes away is soon gone', async () => {
    let at = Date.now()
    const { app } = setup({ panelUrl: PANEL, now: () => at })
    const response = await arrive(app, entry({}, at))
    const cookie = /__portta_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? ''
    expect(response.headers.get('set-cookie')).toContain('Max-Age=3600')
    expect((await app.request('/verify', { headers: { ...forwarded, cookie } })).status).toBe(200)
    at += 3601_000
    expect(
      (await app.request('/verify', { headers: { ...forwarded, cookie, accept: 'application/json' } })).status,
    ).toBe(401)
  })

  it('refuses a token that is old, edited or signed with another secret', async () => {
    const { app } = setup({ panelUrl: PANEL })
    expect((await arrive(app, entry({}, Date.now() - 120_000))).headers.get('set-cookie')).toBeNull()
    expect((await arrive(app, `${entry()}x`)).headers.get('set-cookie')).toBeNull()
    const other = issueSiteEntry(
      { host: 'demo.example.com', scope: 'share:a7f3', epoch: 1, user: 'Ada', state: STATE },
      'cd'.repeat(32),
      Math.floor(Date.now() / 1000),
    )
    expect((await arrive(app, other)).headers.get('set-cookie')).toBeNull()
  })

  it('opens nothing for a browser that did not ask, even with a token that is otherwise good', async () => {
    const { app } = setup({ panelUrl: PANEL })
    const noCookie = await arrive(app, entry(), '/orders', '')
    expect(noCookie.headers.get('location')).toContain('panel=expired')
    expect(noCookie.headers.get('set-cookie') ?? '').not.toContain('__portta_session')
    const otherBrowser = await arrive(
      app,
      entry(),
      '/orders',
      `__Host-portta_entry=${issueEntryState('demo.example.com', 'https', secret)}`,
    )
    expect(otherBrowser.headers.get('location')).toContain('panel=expired')
    expect(otherBrowser.headers.get('set-cookie') ?? '').not.toContain('__portta_session')
  })

  it('spends a token even when it reached the wrong browser, so it cannot be tried again', async () => {
    const { app } = setup({ panelUrl: PANEL })
    const token = entry()
    const wrong = await arrive(
      app,
      token,
      '/orders',
      `__Host-portta_entry=${issueEntryState('demo.example.com', 'https', secret)}`,
    )
    expect(wrong.headers.get('location')).toContain('panel=expired')
    const right = await arrive(app, token)
    expect(right.headers.get('location')).toContain('panel=expired')
    expect(right.headers.get('set-cookie') ?? '').not.toContain('__portta_session')
  })

  it('does not send a browser anywhere but a path on the site', async () => {
    const { app } = setup({ panelUrl: PANEL })
    const response = await arrive(app, entry(), '/\t/evil.example')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
  })

  it('opens nothing on a server that did not say where its panel is', async () => {
    const { app } = setup()
    expect((await arrive(app, entry())).headers.get('set-cookie')).toBeNull()
    const login = await app.request('/__portta/auth/login', { headers: forwarded })
    expect(contextOf(await login.text())).not.toHaveProperty('panel')
  })

  it('offers the panel on the login page, and sends a browser that used it before straight there', async () => {
    const { app } = setup({ panelUrl: PANEL })
    const first = await app.request('/__portta/auth/login?next=%2Forders', { headers: forwarded })
    expect(first.status).toBe(200)
    const panel = contextOf(await first.text()).panel as { url: string }
    expect(panel.url).toMatch(
      new RegExp(`^${PANEL}/api/site-entry\\?host=demo\\.example\\.com&next=%2Forders&state=[A-Za-z0-9_.-]+$`),
    )
    const state = /state=([A-Za-z0-9_.-]+)$/.exec(panel.url)?.[1]
    expect(first.headers.get('set-cookie')).toContain(`__Host-portta_entry=${state}`)

    const returning = await app.request('/__portta/auth/login?next=%2Forders', {
      headers: { ...forwarded, cookie: '__portta_panel=1' },
    })
    expect(returning.status).toBe(302)
    expect(returning.headers.get('location')).toContain(`${PANEL}/api/site-entry?host=demo.example.com`)
  })

  it('says why the panel did not open the site, and shows the password form instead of sending the browser back', async () => {
    const { app } = setup({ panelUrl: PANEL })
    const denied = await app.request('/__portta/auth/login?panel=denied', {
      headers: { ...forwarded, cookie: '__portta_panel=1' },
    })
    expect(denied.status).toBe(200)
    expect(contextOf(await denied.text()).panel).toMatchObject({ notice: 'denied' })
  })
})

describe('crawlers', () => {
  const googlebot = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  const gptbot = 'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2)'
  const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
  const verify = (app: ReturnType<typeof setup>['app'], userAgent: string) =>
    app.request('/verify', { headers: { ...forwarded, accept: 'text/html', 'user-agent': userAgent } })

  it('refuses a crawler by default, on a host that asks for a login and on one that does not', async () => {
    const { app, storePath } = setup()
    expect((await verify(app, googlebot)).status).toBe(403)
    writeProtectionStore(
      storePath,
      setProtection(readProtectionStore(storePath), {
        scope: 'host:api.example.com',
        host: 'api.example.com',
        entryPoints: ['websecure'],
        mode: 'public',
        label: 'api',
      }),
    )
    const open = await app.request('/verify', {
      headers: { ...forwarded, 'x-forwarded-host': 'api.example.com', 'user-agent': gptbot },
    })
    expect(open.status).toBe(403)
  })

  it('does not change what a person with a browser sees', async () => {
    const { app } = setup()
    expect((await verify(app, browser)).status).toBe(302)
  })

  it('lets the kinds the default allows reach the login decision, and still refuses the rest', async () => {
    const { app, storePath } = setup()
    writeProtectionStore(
      storePath,
      setDefaultCrawlers(readProtectionStore(storePath), { search: true, train: false, live: false, preview: false }),
    )
    expect((await verify(app, googlebot)).status).toBe(302)
    expect((await verify(app, gptbot)).status).toBe(403)
  })

  it('answers robots.txt for a host that keeps crawlers out, and has none for one that lets them in', async () => {
    const { app, storePath } = setup()
    const robots = await app.request('/__portta/auth/robots.txt', { headers: forwarded })
    expect(robots.status).toBe(200)
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
    writeProtectionStore(
      storePath,
      setDefaultCrawlers(readProtectionStore(storePath), { search: true, train: true, live: true, preview: true }),
    )
    expect((await app.request('/__portta/auth/robots.txt', { headers: forwarded })).status).toBe(404)
  })

  it('never lets a search engine index the login page', async () => {
    const { app } = setup()
    const login = await app.request('/__portta/auth/login', { headers: forwarded })
    expect(login.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
})

describe('safe redirects', () => {
  it.each([
    'https://evil.example',
    '//evil.example',
    '/%2F/evil',
    '/%5cevil',
    '/ok\r\nLocation: evil',
    '/\t/evil.example',
    '/%09/evil.example',
  ])('rejects %s', (value) => {
    expect(safeNext(value)).toBe('/')
  })
  it('keeps an exact local path and query', () => expect(safeNext('/orders/42?tab=items')).toBe('/orders/42?tab=items'))
})
