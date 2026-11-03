// Where a protected site sends somebody who says they are signed in to the panel.
//
// Answers with a redirect and never with data: back to the site with a token when the panel session
// may see the project behind that host, and back to its login page with the reason when not. The
// address it returns to is the one the protection store holds for the host, never one the request
// supplies, so this cannot be turned into a way to send people elsewhere.

import { Hono } from 'hono'
import { sees } from 'portta-auth-core'
import {
  AUTH_PATH_PREFIX,
  issueSiteEntry,
  normalizeProtectionHost,
  protectionForHost,
  readEntryState,
  readProtectionStore,
  safeLocalPath,
} from 'portta-core'
import { z } from 'portta-core/zod'
import { schemeFor } from '../../config.ts'
import type { AppDeps } from '../../deps.ts'
import { adoptions } from '../../services/access-control.ts'
import { documentRoute } from '../openapi.ts'

/** What the site's application is told about who this is: printable, bounded and unique per account. */
function identityOf(principal: { email: string | null; name: string; userId: string | null }): string {
  const raw = principal.email ?? principal.userId ?? principal.name
  const clean = raw.replace(/[^\x21-\x7e]/g, '').slice(0, 128)
  return clean === '' ? 'panel-user' : clean
}

export function siteEntryRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  const query = (name: string, description: string, required = false) => ({
    name,
    in: 'query' as const,
    required,
    description,
    schema: { type: 'string' as const },
  })

  app.get(
    '/site-entry',
    documentRoute({
      tag: 'Shares',
      operationId: 'enterSite',
      public: true,
      summary: 'Open a protected site with the panel session',
      description:
        'Always a redirect, to the address the protection store holds for the host: with a one-minute single-use token when the session may see the project behind it, and with the reason in `panel` when not. It decides for itself, so it answers without a credential.',
      status: 302,
      response: z.null(),
      parameters: [
        query('host', 'The protected hostname that sent the browser here.', true),
        query('next', 'The path to open afterwards. Anything but a local path becomes /.'),
        query('state', 'What the browser holds, to be signed into the token.', true),
      ],
      errors: [400, 404],
    }),
    async (c) => {
      let host: string
      try {
        host = normalizeProtectionHost(c.req.query('host') ?? '')
      } catch {
        return c.text('Unknown address.', 400)
      }
      const record = protectionForHost(readProtectionStore(deps.config.authStore), host)
      // Only a host that asks for a login has a login page to go back to.
      if (!record || record.mode !== 'protected') return c.text('Unknown address.', 404)

      const next = safeLocalPath(c.req.query('next'))
      const state = c.req.query('state') ?? ''
      // The scheme is the one the login service saw, which only it can sign for this host. A link
      // cannot ask for plain http, and a server that answers on https never goes back to http.
      const seen = deps.config.authSecret ? readEntryState(state, record.host, deps.config.authSecret) : null
      // The floor is https whenever the gateway or the panel itself is served on it: a state is
      // something any visitor can obtain, so it can raise the scheme and never lower it.
      const panelOnHttps = (() => {
        try {
          return new URL(deps.config.panelUrl).protocol === 'https:'
        } catch {
          return false
        }
      })()
      const proto = seen === 'https' || panelOnHttps || schemeFor(deps.config) === 'https' ? 'https' : 'http'
      const site = `${proto}://${record.host}${AUTH_PATH_PREFIX}`
      const back = (reason: 'signedOut' | 'denied' | 'off') =>
        c.redirect(`${site}/login?next=${encodeURIComponent(next)}&panel=${reason}`, 302)

      // Without accounts there is no panel session to speak for anybody.
      if (deps.security.mode === 'open' || !deps.config.authSecret) return back('off')
      const principal = await deps.principals.fromHeaders(c.req.raw.headers)
      if (!principal) return back('signedOut')
      // A browser session. An API token has no business opening a site in a browser.
      if (principal.kind !== 'user') return back('denied')
      if (seen === null) return c.text('Missing or unknown state.', 400)

      // A share, and an environment nobody adopted, belong to whoever sees everything, even when a
      // share names the project it was made from.
      const isShare = record.scope.startsWith('share:')
      const projectId = record.project ? ((await adoptions(deps.db)).get(record.project) ?? null) : null
      const allowed = principal.scope === 'all' || (!isShare && projectId !== null && sees(principal, projectId))
      if (!allowed) return back('denied')

      const token = issueSiteEntry(
        // The address, which is unique, and not the name, which anybody can choose and two people can share.
        { host: record.host, scope: record.scope, epoch: record.epoch, user: identityOf(principal), state },
        deps.config.authSecret,
        Math.floor(Date.now() / 1000),
      )
      return c.redirect(`${site}/panel?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`, 302)
    },
  )

  return app
}
