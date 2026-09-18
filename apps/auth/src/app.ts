import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  normalizeProtectionHost,
  type ProtectionRecord,
  protectionForHost,
  readProtectionStore,
  verifyPassword,
} from 'portta-core'
import { type AuthConfig, loadAuthConfig } from './config.ts'
import { LoginLimiter } from './rate-limit.ts'
import { issueSession, readSession, SESSION_COOKIE } from './session.ts'

export interface AuthAppDependencies {
  config?: AuthConfig
  now?: () => number
  limiter?: LoginLimiter
  log?: (value: Record<string, unknown>) => void
  loadHtml?: () => string
}

interface LoginContext {
  locale: 'en' | 'pt-BR'
  next: string
  error: boolean
  protection: Pick<ProtectionRecord, 'label' | 'host' | 'project' | 'service' | 'tech'>
}

export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/'
  if (/[\r\n\\]/.test(value) || /%(?:0d|0a|2f|5c)/i.test(value)) return '/'
  return value
}

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

  const renderLogin = (
    c: Context,
    protection: ProtectionRecord,
    options: { error?: boolean; status?: 200 | 401 | 429; next?: string } = {},
  ) => {
    const locale = c.req.header('accept-language')?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
    const context: LoginContext = {
      locale,
      next: safeNext(options.next ?? c.req.query('next')),
      error: options.error === true,
      protection: {
        label: protection.label,
        host: protection.host,
        ...(protection.project ? { project: protection.project } : {}),
        ...(protection.service ? { service: protection.service } : {}),
        ...(protection.tech ? { tech: protection.tech } : {}),
      },
    }
    const html = loadHtml().replace(
      '<!--PORTTA_AUTH_CONTEXT-->',
      `<script id="portta-auth-context" type="application/json">${escapeJson(context)}</script>`,
    )
    return c.html(html, options.status ?? 200)
  }

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

  app.get('/__portta/auth/login', (c) => {
    const protection = findProtection(c)
    return protection ? renderLogin(c, protection) : c.text('Protected destination not found.', 404)
  })

  app.post('/__portta/auth/login', async (c) => {
    const protection = findProtection(c)
    const host = forwardedHost(c)
    if (!protection || !host) return c.text('Protected destination not found.', 404)
    if (!originAllowed(c, host)) return c.text('Origin refused.', 403)
    const address = clientAddress(c)
    const key = `${protection.scope}\u0000${address}`
    const allowed = limiter.check(key)
    const body = await c.req.parseBody()
    const next = safeNext(typeof body.next === 'string' ? body.next : '/')
    if (!allowed.allowed) {
      c.header('Retry-After', String(allowed.retryAfter))
      log({ event: 'login', scope: protection.scope, address, outcome: 'locked' })
      return renderLogin(c, protection, { error: true, status: 429, next })
    }
    const user = typeof body.user === 'string' ? body.user : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (user !== protection.user || !(await verifyPassword(password, protection.hash))) {
      const result = await limiter.failure(key)
      if (!result.allowed) c.header('Retry-After', String(result.retryAfter))
      log({ event: 'login', scope: protection.scope, address, outcome: result.allowed ? 'refused' : 'locked' })
      return renderLogin(c, protection, { error: true, status: result.allowed ? 401 : 429, next })
    }
    limiter.success(key)
    const issuedAt = Math.floor(now() / 1000)
    setCookie(
      c,
      SESSION_COOKIE,
      issueSession(
        {
          scope: protection.scope,
          host,
          user: protection.user,
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
