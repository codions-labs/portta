import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ConfigDiscardResult, ConfigPatchResult, ConfigView } from 'portta-contracts'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { buildConfigView, discardConfig, patchConfig } from '../../services/configview.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

const patchBody = z.object({ values: z.record(z.string(), z.union([z.string().max(4096), z.null()])) }).strict()

const discardBody = z.object({ keys: z.array(z.string()).optional() }).strict()

export function configRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Secret values never appear here: the response says whether a token is set,
  // and nothing more.
  app.get(
    '/config',
    documentRoute({
      tag: 'Configuration',
      operationId: 'getConfig',
      permission: 'settings:read',
      summary: 'Get the managed settings catalogue',
      description: 'Secret values are never returned; only whether they are set.',
      response: ConfigView,
      errors: [500],
    }),
    (c) => c.json(buildConfigView(deps.config)),
  )

  app.patch(
    '/config',
    documentRoute({
      tag: 'Configuration',
      operationId: 'patchConfig',
      permission: 'settings:manage',
      summary: 'Save managed settings',
      response: ConfigPatchResult,
      request: patchBody,
      errors: [400, 403, 500],
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null)
      const parsed = patchBody.safeParse(body)
      if (!parsed.success) {
        throw new HTTPException(400, { message: 'send {"values": {"KEY": "value"}}' })
      }
      const result = patchConfig(deps.config, parsed.data.values)
      // The names, never the values: half of this catalogue is secrets, and the
      // question the log answers is which setting somebody changed and when.
      // Called `changed` rather than `keys` because the scrubber redacts a field
      // named `keys` — correctly, and this is not one.
      await record(deps, c, {
        action: 'settings.changed',
        resourceType: 'settings',
        resourceName: 'gateway',
        metadata: { changed: result.saved },
      })
      return c.json(result)
    },
  )

  app.post(
    '/config/discard',
    documentRoute({
      tag: 'Configuration',
      operationId: 'discardConfig',
      permission: 'settings:manage',
      summary: 'Discard saved settings that are not running yet',
      description:
        'Writes the running values back into .env. Omit keys to discard every pending change. Secret values never leave this process.',
      response: ConfigDiscardResult,
      request: discardBody,
      errors: [400, 403, 500],
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null)
      const parsed = discardBody.safeParse(body ?? {})
      if (!parsed.success) {
        throw new HTTPException(400, { message: 'send {"keys": ["KEY"]} or {}' })
      }
      const result = discardConfig(deps.config, parsed.data.keys)
      await record(deps, c, {
        action: 'settings.discarded',
        resourceType: 'settings',
        resourceName: 'gateway',
        metadata: { changed: result.discarded },
      })
      return c.json(result)
    },
  )

  return app
}
