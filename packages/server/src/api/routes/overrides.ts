import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope } from 'portta-auth-core/hono'
import { EnvironmentOverrides, ServiceOverrides } from 'portta-contracts'
import { z } from 'zod'
import { requireDatabase } from '../../db/index.ts'
import { ENVIRONMENT_KEYS, type EnvironmentSettingKey } from '../../db/keys.ts'
import type { AppDeps } from '../../deps.ts'
import { projectOfEnvironment } from '../../services/access-control.ts'
import { loadAliases, OverrideRefused, planAlias, saveAliases, sortAliases } from '../../services/overrides.ts'
import { documentRoute, projectParameter } from '../openapi.ts'

const serviceParameter = {
  name: 'service',
  in: 'path' as const,
  required: true,
  description: 'Compose service name within the project.',
  schema: { type: 'string' as const },
}

/** Every project override, and `null` for anything the user cleared. */
const EnvironmentSettingsBody = z
  .object({
    displayName: z.string().min(1).max(120).nullable(),
    description: z.string().max(2000).nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    pinned: z.boolean().nullable(),
    archived: z.boolean().nullable(),
    primaryService: z.string().min(1).max(128).nullable(),
    hiddenServices: z.array(z.string().min(1).max(128)).max(256).nullable(),
    serviceOrder: z.array(z.string().min(1).max(128)).max(256).nullable(),
  })
  .partial()
  .strict()
  .meta({ ref: 'EnvironmentSettingsBody' })

const AliasBody = z
  .object({ alias: z.string().min(1).max(253) })
  .strict()
  .meta({ ref: 'AliasBody' })

const AliasResult = z
  .object({
    project: z.string(),
    service: z.string(),
    host: z.string().describe('The hostname Traefik now answers on, beside the derived one'),
    derivedHosts: z.array(z.string()).describe('What the project itself declares; never replaced'),
    port: z.number().int(),
    entryPoint: z.string(),
    file: z.string().describe('The generated Traefik file this was written to'),
  })
  .strict()
  .meta({ ref: 'AliasResult' })

/**
 * The UI invalidates on Docker events already; an override is a change it can
 * see the same way rather than a second refresh mechanism.
 */
function announce(deps: AppDeps, project: string): void {
  deps.hub.publish({
    kind: 'config',
    action: 'overrides',
    id: null,
    name: null,
    project,
    ownership: null,
    at: Math.floor(Date.now() / 1000),
  })
}

export function overrideRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function projectRecord(c: Context, name: string) {
    const snapshot = await deps.cache.get()
    if (!snapshot.environments.some((item) => item.name === name)) {
      throw new HTTPException(404, { message: `no project '${name}' is running` })
    }
    // The environment belongs to whichever Project adopted it; one nothing
    // adopted belongs to nobody, and is for `scope: 'all'` alone.
    authorizeScope(c, await projectOfEnvironment(deps.db, name))
    const db = requireDatabase(deps.db)
    // Identity is COMPOSE_PROJECT_NAME, so two worktrees are two environments
    // with two sets of overrides. A new worktree starts blank, deliberately.
    const record = (await db.environments.find(name)) ?? (await db.environments.upsertSeen({ composeProject: name }))
    return { db, record, snapshot }
  }

  app.get(
    '/environments/:project/settings',
    documentRoute({
      tag: 'Environments',
      operationId: 'getEnvironmentSettings',
      permission: 'environment:read',
      summary: "Read an environment's overrides",
      response: EnvironmentOverrides,
      parameters: [projectParameter],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const { db, record } = await projectRecord(c, c.req.param('project'))
      const stored: Record<string, unknown> = {}
      for (const key of Object.keys(ENVIRONMENT_KEYS) as EnvironmentSettingKey[]) {
        const value = await db.settings.getEnvironment(record.id, key)
        if (value !== null) stored[key] = value
      }
      return c.json(stored)
    },
  )

  app.put(
    '/environments/:project/settings',
    documentRoute({
      tag: 'Environments',
      operationId: 'setEnvironmentSettings',
      permission: 'environment:settings',
      summary: "Set or clear an environment's overrides",
      description: 'Presentation only: nothing here changes routing, and nothing is written inside the project.',
      request: EnvironmentSettingsBody,
      response: EnvironmentOverrides,
      parameters: [projectParameter],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = EnvironmentSettingsBody.parse(await c.req.json())
      const { db, record } = await projectRecord(c, c.req.param('project'))

      for (const [key, value] of Object.entries(body) as [EnvironmentSettingKey, unknown][]) {
        if (value === null) await db.settings.clearEnvironment(record.id, key)
        else await db.settings.setEnvironment(record.id, key, value as never)
      }

      const stored: Record<string, unknown> = {}
      for (const key of Object.keys(ENVIRONMENT_KEYS) as EnvironmentSettingKey[]) {
        const value = await db.settings.getEnvironment(record.id, key)
        if (value !== null) stored[key] = value
      }
      announce(deps, c.req.param('project'))
      return c.json(stored)
    },
  )

  app.delete(
    '/environments/:project/settings',
    documentRoute({
      tag: 'Environments',
      operationId: 'clearEnvironmentSettings',
      permission: 'environment:settings',
      summary: 'Remove every override on an environment',
      response: z
        .object({ ok: z.boolean(), cleared: z.array(z.string()) })
        .strict()
        .meta({ ref: 'ClearedSettings' }),
      parameters: [projectParameter],
      errors: [403, 404, 500, 503],
    }),
    async (c) => {
      const { db, record } = await projectRecord(c, c.req.param('project'))
      const cleared: string[] = []
      for (const key of Object.keys(ENVIRONMENT_KEYS) as EnvironmentSettingKey[]) {
        if ((await db.settings.getEnvironment(record.id, key)) === null) continue
        await db.settings.clearEnvironment(record.id, key)
        cleared.push(key)
      }
      announce(deps, c.req.param('project'))
      return c.json({ ok: true, cleared })
    },
  )

  app.get(
    '/environments/:project/services/:service/overrides',
    documentRoute({
      tag: 'Environments',
      operationId: 'getServiceOverrides',
      permission: 'environment:read',
      summary: "Read one service's overrides",
      response: ServiceOverrides,
      parameters: [projectParameter, serviceParameter],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const { db, record } = await projectRecord(c, c.req.param('project'))
      const service = c.req.param('service')
      const stored: Record<string, unknown> = {}
      for (const key of ['alias', 'note', 'hidden'] as const) {
        const value = await db.settings.getService(record.id, service, key)
        if (value !== null) stored[key] = value
      }
      return c.json(stored)
    },
  )

  app.put(
    '/environments/:project/services/:service/note',
    documentRoute({
      tag: 'Environments',
      operationId: 'setServiceNote',
      permission: 'environment:settings',
      summary: 'Set or clear a note on a service',
      request: z
        .object({ note: z.string().max(2000).nullable() })
        .strict()
        .meta({ ref: 'ServiceNoteBody' }),
      response: ServiceOverrides,
      parameters: [projectParameter, serviceParameter],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = z
        .object({ note: z.string().max(2000).nullable() })
        .strict()
        .parse(await c.req.json())
      const { db, record } = await projectRecord(c, c.req.param('project'))
      const service = c.req.param('service')
      if (body.note === null) await db.settings.clearService(record.id, service, 'note')
      else await db.settings.setService(record.id, service, 'note', body.note)
      announce(deps, c.req.param('project'))
      return c.json(body.note === null ? {} : { note: body.note })
    },
  )

  /**
   * The one override that leaves the panel.
   *
   * Row and file are written as one operation: the generated file is rendered
   * whole from the stored state, and a failed write rolls the row back, so the
   * database and Traefik cannot end up disagreeing about what answers.
   */
  app.put(
    '/environments/:project/services/:service/alias',
    documentRoute({
      tag: 'Environments',
      operationId: 'setServiceAlias',
      permission: 'environment:settings',
      summary: 'Route an additional hostname to a service',
      description:
        "Additive: the project's own hostname keeps working beside the alias. Refused before any write when the hostname collides, sits outside a served domain, or has no unambiguous HTTP port.",
      request: AliasBody,
      response: AliasResult,
      parameters: [projectParameter, serviceParameter],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = AliasBody.parse(await c.req.json())
      const projectName = c.req.param('project')
      const service = c.req.param('service')
      const { db, record, snapshot } = await projectRecord(c, projectName)

      const existing = loadAliases(deps.config)
      const planned = planAlias({ project: projectName, service, alias: body.alias }, snapshot, existing, deps.config)

      const previous = await db.settings.getService(record.id, service, 'alias')
      await db.settings.setService(record.id, service, 'alias', planned.host)

      try {
        const next = sortAliases([
          ...existing.filter((alias) => !(alias.project === projectName && alias.service === service)),
          planned,
        ])
        saveAliases(deps.config, next)
      } catch (cause) {
        if (previous === null) await db.settings.clearService(record.id, service, 'alias')
        else await db.settings.setService(record.id, service, 'alias', previous)
        throw cause
      }

      const target = snapshot.environments
        .find((item) => item.name === projectName)!
        .services.find((item) => (item.service ?? item.name) === service)!

      announce(deps, c.req.param('project'))
      return c.json({
        project: projectName,
        service,
        host: planned.host,
        derivedHosts: target.urls.map((url) => url.host),
        port: planned.port,
        entryPoint: planned.entryPoint,
        file: 'portta-aliases.yaml',
      })
    },
  )

  app.delete(
    '/environments/:project/services/:service/alias',
    documentRoute({
      tag: 'Environments',
      operationId: 'clearServiceAlias',
      permission: 'environment:settings',
      summary: 'Remove a hostname alias',
      response: z.object({ ok: z.boolean(), removed: z.string().nullable() }).strict().meta({ ref: 'AliasRemoval' }),
      parameters: [projectParameter, serviceParameter],
      errors: [403, 404, 500, 503],
    }),
    async (c) => {
      const projectName = c.req.param('project')
      const service = c.req.param('service')
      const { db, record } = await projectRecord(c, projectName)

      const existing = loadAliases(deps.config)
      const removed = existing.find((alias) => alias.project === projectName && alias.service === service) ?? null

      await db.settings.clearService(record.id, service, 'alias')
      saveAliases(
        deps.config,
        sortAliases(existing.filter((alias) => !(alias.project === projectName && alias.service === service))),
      )

      announce(deps, c.req.param('project'))
      return c.json({ ok: true, removed: removed?.host ?? null })
    },
  )

  return app
}

export { OverrideRefused }
