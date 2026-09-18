// The daemon's HTTP surface: health, and the modules behind a token.
//
// Deliberately small. A request that reaches a module route has already been
// authorised by the panel against a Portta permission; what this adds is proof
// that the request came from something that can read the token file.

import { Hono } from 'hono'
import { bearerToken, tokenMatches } from './auth.ts'
import { createForgeRoutes } from './forge/routes.ts'
import type { HostContext, HostModule } from './modules/index.ts'

export const HOST_PUBLIC_ROUTES: ReadonlySet<string> = new Set(['GET /api/health'])

export interface HostAppOptions {
  token: string
  modules: readonly HostModule[]
  context: HostContext
}

export function createHostApp(options: HostAppOptions): Hono {
  const app = new Hono()

  app.onError((error, c) => c.json({ error: 'unexpected failure', detail: String(error) }, 500))

  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store')
    c.header('x-content-type-options', 'nosniff')
    // Liveness is the one answer a caller without the token may have, so a
    // supervisor can tell "down" from "refusing me" without holding the secret.
    if (HOST_PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`)) return next()
    if (!tokenMatches(bearerToken(c.req.header('authorization')), options.token)) {
      return c.json(
        { error: 'the host daemon needs its token', hint: 'send Authorization: Bearer <state/host/token>' },
        401,
      )
    }
    return next()
  })

  app.get('/api/health', (c) => c.json({ ok: true }))

  // Not a module's route: reading and writing issues is the panel's work
  // surface now, and `gh` lives on the host. What is optional is whether `gh`
  // is installed and signed in, which `/api/forge/status` reports rather than
  // hides (ADR 0018).
  app.route('/api/forge', createForgeRoutes())

  for (const module of options.modules) {
    if (module.routes) app.route(`/api/modules/${module.manifest.id}`, module.routes(options.context))
  }

  app.all('*', (c) => c.json({ error: `no such endpoint: ${c.req.path}` }, 404))
  return app
}
