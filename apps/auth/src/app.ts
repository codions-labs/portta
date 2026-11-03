import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  crawlerMayRead,
  crawlersFor,
  issueEntryState,
  normalizeProtectionHost,
  type ProtectionRecord,
  protectionForHost,
  readEntryState,
  readProtectionStore,
  readSiteEntry,
  renderRobots,
  safeLocalPath,
  verifyPassword,
} from 'portta-core'
import { type AuthConfig, loadAuthConfig } from './config.ts'
import { LoginLimiter } from './rate-limit.ts'
import { issueSession, readSession, SESSION_COOKIE } from './session.ts'

/** Remembers, per host, that this browser got in with the panel before, so it is sent there at once. */
const PANEL_HINT_COOKIE = '__portta_panel'
/** Ties a token from the panel to the browser that asked for it, as `state` does in OAuth. */
const PANEL_STATE_COOKIE = '__portta_entry'
/**
 * On https the cookie carries the `__Host-` prefix, which a browser accepts only without a Domain
 * and from the host itself, so a sibling host cannot plant one for this one to read.
 */
const stateCookie = (secure: boolean) => (secure ? `__Host-${PANEL_STATE_COOKIE.slice(2)}` : PANEL_STATE_COOKIE)

export interface AuthAppDependencies {
  config?: AuthConfig
  now?: () => number
  limiter?: LoginLimiter
  log?: (value: Record<string, unknown>) => void
  loadHtml?: () => string
}

interface LoginContext {
  locale: 'en' | 'pt-BR'
  /** `unavailable`: nothing is protected here any more, which is what an ended link looks like. */
  state: 'login' | 'unavailable'
  next: string
  error: boolean
  /** Whole minutes until another try, when too many wrong ones locked the page. */
  lockedMinutes?: number
  /**
   * Present when a session of the panel may open this site. `url` is where the browser goes to
   * ask the panel; `notice` is why the last try did not get in.
   */
  panel?: { url: string; notice?: 'signedOut' | 'denied' | 'expired' }
  protection?: Pick<ProtectionRecord, 'label' | 'host' | 'project' | 'service' | 'tech'> & {
    /** Nobody is asked for a username: the password alone opens it. */
    passwordOnly: boolean
  }
}

function localeOf(c: Context): 'en' | 'pt-BR' {
  return c.req.header('accept-language')?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

export const safeNext = safeLocalPath

function forwardedHost(c: Context): string | null {
  const raw = c.req.header('x-forwarded-host')
  if (!raw) return null
  try {
    return normalizeProtectionHost(raw)
  } catch {
    return null
  }
}

/**
 * Where a browser is sent to log in.
 *
 * Absolute, and that is not a style choice. Traefik resolves a relative
 * `Location` from a ForwardAuth response against the *auth service's* own URL,
 * so `/__portta/auth/login` reached the browser as
 * `http://portta-auth:4180/__portta/auth/login` — an internal container name
 * nothing outside the Docker network can resolve, and the login page was never
 * shown. The generated dynamic file already puts a login router on the
 * protected host itself, so the right address is that host.
 *
 * Built only from headers the trusted proxy set, which `requireForwarded` has
 * already checked: a request that did not come through Traefik never reaches
 * here, so the host cannot be attacker-chosen.
 */
function loginUrl(c: Context, next: string): string {
  const host = forwardedHost(c)
  const path = `/__portta/auth/login?next=${encodeURIComponent(next)}`
  return host ? `${effectiveProtocol(c)}://${host}${path}` : path
}

function clientAddress(c: Context): string {
  const chain = c.req
    .header('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return chain?.at(-1) ?? 'unknown'
}

function effectiveProtocol(c: Context): string {
  return (c.req.header('x-forwarded-proto') || 'http').split(',').at(-1)?.trim().toLowerCase() || 'http'
}

function isNavigation(c: Context): boolean {
  if (c.req.header('upgrade') || c.req.header('x-requested-with')) return false
  const destination = c.req.header('sec-fetch-dest')?.toLowerCase()
  if (destination && destination !== 'document' && destination !== 'iframe') return false
  if (c.req.header('sec-fetch-mode')?.toLowerCase() === 'navigate') return true
  if (c.req.header('accept')?.toLowerCase().includes('text/event-stream')) return false
  return c.req.header('accept')?.toLowerCase().includes('text/html') === true
}

function originAllowed(c: Context, host: string): boolean {
  const origin = c.req.header('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === `${effectiveProtocol(c)}://${host}`
  } catch {
    return false
  }
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

export function createAuthApp(dependencies: AuthAppDependencies = {}): Hono {
  const config = dependencies.config ?? loadAuthConfig()
  const now = dependencies.now ?? Date.now
  const limiter = dependencies.limiter ?? new LoginLimiter({ now })
  const log = dependencies.log ?? ((value) => process.stdout.write(`${JSON.stringify(value)}\n`))
  const loadHtml = dependencies.loadHtml ?? (() => readFileSync(join(config.uiDir, 'index.html'), 'utf8'))
  const app = new Hono()

  const findProtection = (c: Context): ProtectionRecord | null => {
    const store = readProtectionStore(config.storePath)
    const requestedScope = c.req.query('scope')
    if (requestedScope) return store.protections.find((item) => item.scope === requestedScope) ?? null
    const host = forwardedHost(c)
    return host ? protectionForHost(store, host) : null
  }

  /** Where this host asks the panel whether the browser's session may open it. */
  const panelEntryUrl = (c: Context, next: string): string | null => {
    const host = forwardedHost(c)
    if (!config.panelUrl || !host) return null
    const proto = effectiveProtocol(c) === 'http' ? 'http' : 'https'
    // Signed with the host and the scheme this request arrived on, and remembered by this browser
    // alone: a token made for somebody else's request is not accepted from a link they were sent.
    const state = issueEntryState(host, proto, config.secret)
    setCookie(c, stateCookie(proto === 'https'), state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: proto === 'https',
      path: proto === 'https' ? '/' : '/__portta/auth',
      maxAge: 600,
    })
    return `${config.panelUrl}/api/site-entry?host=${encodeURIComponent(host)}&next=${encodeURIComponent(next)}&state=${state}`
  }

  const panelContext = (c: Context, nextValue?: string): Pick<LoginContext, 'panel'> => {
    const notice = c.req.query('panel')
    if (notice === 'off') return {}
    const url = panelEntryUrl(c, safeNext(nextValue ?? c.req.query('next')))
    if (!url) return {}
    return {
      panel: {
        url,
        ...(notice === 'signedOut' || notice === 'denied' || notice === 'expired' ? { notice } : {}),
      },
    }
  }

  /** Tokens already spent, so one made for a single entry cannot open a second. */
  const spentEntries = new Map<string, number>()

  const startSession = (c: Context, protection: ProtectionRecord, host: string, user: string) => {
    const issuedAt = Math.floor(now() / 1000)
    setCookie(
      c,
      SESSION_COOKIE,
      issueSession(
        {
          scope: protection.scope,
          host,
          user,
          issuedAt,
          expiresAt: issuedAt + config.sessionSeconds,
          epoch: protection.epoch,
        },
        config.secret,
      ),
      {
        httpOnly: true,
        sameSite: 'Lax',
        secure: effectiveProtocol(c) === 'https',
        path: '/',
        maxAge: config.sessionSeconds,
      },
    )
  }

  const renderLogin = (
    c: Context,
    protection: ProtectionRecord,
    options: { error?: boolean; status?: 200 | 401 | 429; next?: string; retryAfter?: number } = {},
  ) => {
    const context: LoginContext = {
      locale: localeOf(c),
      state: 'login',
      next: safeNext(options.next ?? c.req.query('next')),
      error: options.error === true,
      ...panelContext(c, options.next),
      ...(options.status === 429 && options.retryAfter
        ? { lockedMinutes: Math.max(1, Math.ceil(options.retryAfter / 60)) }
        : {}),
      protection: {
        label: protection.label,
        host: protection.host,
        passwordOnly: protection.user === undefined,
        ...(protection.project ? { project: protection.project } : {}),
        ...(protection.service ? { service: protection.service } : {}),
        ...(protection.tech ? { tech: protection.tech } : {}),
      },
    }
    return page(c, context, options.status ?? 200)
  }

  const page = (c: Context, context: LoginContext, status: 200 | 401 | 404 | 429) => {
    const html = loadHtml().replace(
      '<!--PORTTA_AUTH_CONTEXT-->',
      `<script id="portta-auth-context" type="application/json">${escapeJson(context)}</script>`,
    )
    return c.html(html, status)
  }

  // Nothing here says whether the address ever existed: a hostname nobody protects and
  // a link that ended answer the same, so this cannot be used to probe for either.
  const unavailable = (c: Context) =>
    page(c, { locale: localeOf(c), state: 'unavailable', next: '/', error: false }, 404)

  app.get('/health', (c) => {
    try {
      readProtectionStore(config.storePath)
      return c.json({ status: 'ok' })
    } catch (error) {
      return c.json({ status: 'error', error: error instanceof Error ? error.message : String(error) }, 503)
    }
  })

  // Traefik preserves the protected request method for its auth subrequest.
  // Accept all methods so POST webhooks and other non-GET clients can pass.
  app.all('/verify', async (c) => {
    const protection = findProtection(c)
    const host = forwardedHost(c)
    if (!protection || !host || protection.host !== host) return c.body(null, 401)
    // A crawler the host keeps out is refused by the name it gives, before anything else is
    // decided: robots.txt only asks, and this is what answers the ones that do not listen.
    if (!crawlerMayRead(crawlersFor(readProtectionStore(config.storePath), protection), c.req.header('user-agent'))) {
      return c.text('Crawlers are not allowed here.', 403)
    }
    // Decided per hostname, in the record and nowhere else: a public host is
    // let through at once, and there is nothing to send a browser to.
    if (protection.mode === 'public') return c.body(null, 200)

    const session = readSession(getCookie(c, SESSION_COOKIE) ?? '', config.secret)
    const second = Math.floor(now() / 1000)
    if (
      session &&
      session.scope === protection.scope &&
      session.host === host &&
      session.epoch === protection.epoch &&
      session.expiresAt > second
    ) {
      c.header('X-Forwarded-User', session.user)
      c.header('X-Portta-Actor', session.user)
      c.header('X-Portta-Actor-Kind', 'human')
      return c.body(null, 200)
    }

    if (!isNavigation(c)) return c.body(null, 401)
    const next = safeNext(c.req.header('x-forwarded-uri'))
    return c.redirect(loginUrl(c, next), 302)
  })

  // Reached through a router the generated file puts on each host that keeps a crawler out.
  app.get('/__portta/auth/robots.txt', (c) => {
    const protection = findProtection(c)
    const robots = protection ? renderRobots(crawlersFor(readProtectionStore(config.storePath), protection)) : null
    if (robots === null) return c.body(null, 404)
    c.header('Cache-Control', 'public, max-age=3600')
    return c.text(robots)
  })

  // Nothing Portta serves for a login should ever be found by a search.
  app.use('/__portta/auth/*', async (c, next) => {
    await next()
    c.header('X-Robots-Tag', 'noindex, nofollow')
  })

  app.get('/__portta/auth/login', (c) => {
    const protection = findProtection(c)
    if (protection?.mode !== 'protected') return unavailable(c)
    // A browser that got in with the panel before goes there again by itself. One that has
    // never done it sees the password form first, so a person who cannot reach the panel is
    // never sent to a page they cannot open.
    if (!c.req.query('panel') && getCookie(c, PANEL_HINT_COOKIE) === '1') {
      const url = panelEntryUrl(c, safeNext(c.req.query('next')))
      if (url) return c.redirect(url, 302)
    }
    return renderLogin(c, protection)
  })

  // Where the panel sends the browser back with a token for this host.
  app.get('/__portta/auth/panel', (c) => {
    const protection = findProtection(c)
    const host = forwardedHost(c)
    if (protection?.mode !== 'protected' || !host || protection.host !== host) return unavailable(c)
    const next = safeNext(c.req.query('next'))
    const second = Math.floor(now() / 1000)
    const token = config.panelUrl ? readSiteEntry(c.req.query('token') ?? '', config.secret, second) : null
    for (const [id, expiresAt] of spentEntries) if (expiresAt <= second) spentEntries.delete(id)
    const refused = () => c.redirect(`${loginUrl(c, next)}&panel=expired`, 302)
    if (!token || spentEntries.has(token.id)) return refused()
    // Spent first: a token that reached a browser that did not ask for it cannot be tried again.
    spentEntries.set(token.id, token.expiresAt)
    if (token.host !== host || token.scope !== protection.scope || token.epoch !== protection.epoch) return refused()
    const secure = effectiveProtocol(c) === 'https'
    const state = getCookie(c, stateCookie(secure))
    deleteCookie(c, stateCookie(secure), { path: secure ? '/' : '/__portta/auth', secure })
    if (!state || readEntryState(state, host, config.secret) === null || state !== token.state) return refused()
    startSession(c, protection, host, token.user)
    setCookie(c, PANEL_HINT_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: effectiveProtocol(c) === 'https',
      path: '/__portta/auth',
      maxAge: 60 * 60 * 24 * 30,
    })
    log({ event: 'login', scope: protection.scope, address: clientAddress(c), outcome: 'panel' })
    return c.redirect(next, 303)
  })

  app.post('/__portta/auth/login', async (c) => {
    const protection = findProtection(c)
    const host = forwardedHost(c)
    if (protection?.mode !== 'protected' || !host) return unavailable(c)
    if (!originAllowed(c, host)) return c.text('Origin refused.', 403)
    const address = clientAddress(c)
    const key = `${protection.scope}\u0000${address}`
    const allowed = limiter.check(key)
    const body = await c.req.parseBody()
    const next = safeNext(typeof body.next === 'string' ? body.next : '/')
    if (!allowed.allowed) {
      c.header('Retry-After', String(allowed.retryAfter))
      log({ event: 'login', scope: protection.scope, address, outcome: 'locked' })
      return renderLogin(c, protection, { error: true, status: 429, next, retryAfter: allowed.retryAfter })
    }
    const user = typeof body.user === 'string' ? body.user : ''
    const password = typeof body.password === 'string' ? body.password : ''
    // A record with no username asks for none, and one that has a username still checks it.
    const userMatches = protection.user === undefined || user === protection.user
    if (!userMatches || !protection.hash || !(await verifyPassword(password, protection.hash))) {
      const result = await limiter.failure(key)
      if (!result.allowed) c.header('Retry-After', String(result.retryAfter))
      log({ event: 'login', scope: protection.scope, address, outcome: result.allowed ? 'refused' : 'locked' })
      return renderLogin(c, protection, {
        error: true,
        status: result.allowed ? 401 : 429,
        next,
        ...(result.allowed ? {} : { retryAfter: result.retryAfter }),
      })
    }
    limiter.success(key)
    // Somebody who only knew the password is nobody in particular, and a header is a string.
    startSession(c, protection, host, protection.user ?? 'guest')
    log({ event: 'login', scope: protection.scope, address, outcome: 'accepted' })
    return c.redirect(next, 303)
  })

  app.post('/__portta/auth/logout', (c) => {
    const host = forwardedHost(c)
    if (!host || !originAllowed(c, host)) return c.text('Origin refused.', 403)
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: effectiveProtocol(c) === 'https' })
    return c.redirect('/', 303)
  })

  app.use(
    '/__portta/auth/*',
    serveStatic({
      root: config.uiDir,
      rewriteRequestPath: (path) => path.replace(/^\/__portta\/auth\/?/, '/'),
    }),
  )

  return app
}
