import { Hono } from 'hono'
import { TunnelView } from 'portta-contracts'
import { isWritable, patchEnvFile } from 'portta-core'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { forgetTunnel, TunnelSetupError, tunnelView } from '../../services/tunnel.ts'
import { documentRoute } from '../openapi.ts'

/**
 * Cloudflare Tunnel, configured from the panel.
 *
 * The token is accepted here and never leaves: no response body contains it,
 * and the `.env` this writes carries only the zone and the enable flag, both of
 * which are ordinary configuration. The credential lives in one 0600 file.
 *
 * Enabling does not start anything. It writes configuration and flips one
 * variable, and the response says which command applies it — the same contract
 * every other gateway setting has, so there is exactly one way containers get
 * started. See docs/development/adr/0001-decoupled-infrastructure.md.
 */
export function tunnelRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function observe() {
    const name = `${deps.config.projectName}-cloudflared-1`
    let containerState: string | null = null
    let containerHealth: string | null = null
    let logTail = ''
    try {
      const snapshot = await deps.cache.get()
      const found = snapshot.containers.find((container) => container.name === name)
      containerState = found?.state ?? null
      containerHealth = found?.health ?? null
      if (found) {
        // The connector's own words are the only place an authentication
        // failure shows up; the state model reads them and nothing here keeps
        // them, so no log line reaches the response.
        const lines = await deps.client.logs(found.id, { tail: 200 }).catch(() => [])
        logTail = lines.map((line) => line.text).join('\n')
      }
    } catch {
      // A Docker that cannot be reached is reported by the gateway status card;
      // here it simply means the connector cannot be observed.
    }
    const snapshot = await deps.cache.get().catch(() => null)
    const endpointCount =
      snapshot?.containers.filter((container) => container.ownership !== 'gateway' && container.urls.length > 0)
        .length ?? 0
    return { containerState, containerHealth, logTail, endpointCount, imageAvailable: true }
  }

  app.get(
    '/tunnel',
    documentRoute({
      tag: 'Network',
      operationId: 'getTunnel',
      permission: 'settings:read',
      summary: 'Cloudflare Tunnel state and routes',
      response: TunnelView,
      errors: [500],
    }),
    async (c) => c.json(tunnelView(deps.config, await observe())),
  )

  const SetupBody = z
    .object({
      zone: z.string().min(1),
      // Write-only, in every sense: accepted here, never returned anywhere.
      token: z.string().min(1),
      includeApex: z.boolean().optional(),
    })
    .strict()

  app.post(
    '/tunnel/setup',
    documentRoute({
      tag: 'Network',
      operationId: 'setupTunnel',
      permission: 'settings:manage',
      summary: 'Configure the connector from a tunnel token',
      request: SetupBody,
      response: TunnelView,
      errors: [400, 403, 500],
    }),
    async (c) => {
      if (deps.config.readOnly) return c.json({ error: 'the panel is read-only' }, 403)
      const body = SetupBody.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: 'a domain and a tunnel token are required' }, 400)

      try {
        const { writeTunnelSetup } = await import('../../services/tunnel.ts')
        const result = writeTunnelSetup(deps.config, {
          zone: body.data.zone,
          token: body.data.token,
          includeApex: body.data.includeApex,
        })
        // The zone is configuration, not a credential, so it belongs in .env
        // where `portta up` and the CLI both read it.
        applyEnv(deps, { CLOUDFLARE_TUNNEL_ZONE: result.zone, CLOUDFLARE_TUNNEL_ID: result.tunnelId })
      } catch (error) {
        if (error instanceof TunnelSetupError) return c.json({ error: error.message }, 400)
        throw error
      }
      // Re-read so the response describes the state that now exists on disk.
      deps.config.tunnelZone = body.data.zone.trim().toLowerCase()
      return c.json(tunnelView(deps.config, await observe()))
    },
  )

  app.post(
    '/tunnel/enable',
    documentRoute({
      tag: 'Network',
      operationId: 'enableTunnel',
      permission: 'settings:manage',
      summary: 'Include the connector in the running stack',
      response: TunnelView,
      errors: [400, 403, 500],
    }),
    async (c) => {
      if (deps.config.readOnly) return c.json({ error: 'the panel is read-only' }, 403)
      const view = tunnelView(deps.config, await observe())
      if (!view.credentialConfigured || !view.zone) {
        return c.json({ error: 'configure a domain and a tunnel token first' }, 400)
      }
      applyEnv(deps, { CLOUDFLARE_TUNNEL_ENABLED: 'true' })
      deps.config.tunnelEnabled = true
      return c.json(tunnelView(deps.config, await observe()))
    },
  )

  const DisableBody = z
    .object({
      /** Also delete the configuration, so re-enabling means pasting a token again. */
      forget: z.boolean().optional(),
    })
    .strict()

  app.post(
    '/tunnel/disable',
    documentRoute({
      tag: 'Network',
      operationId: 'disableTunnel',
      permission: 'settings:manage',
      summary: 'Stop including the connector',
      request: DisableBody,
      response: TunnelView,
      errors: [403, 500],
    }),
    async (c) => {
      if (deps.config.readOnly) return c.json({ error: 'the panel is read-only' }, 403)
      const body = DisableBody.safeParse(await c.req.json().catch(() => ({})))
      applyEnv(deps, { CLOUDFLARE_TUNNEL_ENABLED: 'false' })
      deps.config.tunnelEnabled = false
      // Nothing in the Cloudflare account is touched, in either case: the tunnel,
      // the DNS record and any Access policy are the operator's to remove.
      if (body.success && body.data.forget === true) {
        forgetTunnel(deps.config)
        applyEnv(deps, { CLOUDFLARE_TUNNEL_ID: '' })
        deps.config.tunnelZone = null
      }
      return c.json(tunnelView(deps.config, await observe()))
    },
  )

  return app
}

/** One place that writes .env, so a failure to write is reported the same way. */
function applyEnv(deps: AppDeps, values: Record<string, string>): void {
  if (!isWritable(deps.config.envFile)) throw new Error('.env is not writable by the panel')
  patchEnvFile(deps.config.envFile, values)
}
