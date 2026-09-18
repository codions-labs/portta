import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ApplyResult, ApplyStatus, Diagnostic, GatewayStatus, LogsResponse, TraefikVerdict } from 'portta-contracts'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { moduleDiagnostics, SERVER_MODULES } from '../../modules/index.ts'
import { ActionRefused } from '../../services/actions.ts'
import { applier, applyStatus } from '../../services/apply.ts'
import { diagnose } from '../../services/diagnostics.ts'
import { DockerApiError } from '../../services/docker/client.ts'
import { componentOf, gatewayStatus, RESTARTABLE_COMPONENTS } from '../../services/gateway.ts'
import { forgeStatus } from '../../services/issues/host-client.ts'
import { loadAliases } from '../../services/overrides.ts'
import { record } from '../audit.ts'
import { documentRoute, tailParameter } from '../openapi.ts'
import { readLogs } from './services.ts'

const restartBody = z.object({ components: z.array(z.enum(RESTARTABLE_COMPONENTS)).min(1).optional() }).strict()

export const DoctorResponse = z
  .object({
    checks: z.array(Diagnostic),
    failures: z.number().int(),
    warnings: z.number().int(),
    ranAt: z.number(),
    hostCommand: z.string(),
  })
  .strict()
  .meta({ ref: 'DoctorResponse' })
export const RestartResponse = z
  .object({
    ok: z.literal(true),
    restarted: z.array(z.string()),
    missing: z.array(z.string()),
    note: z.string(),
    applyCommand: z.string(),
  })
  .strict()
  .meta({ ref: 'RestartResponse' })

export function gatewayRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get(
    '/gateway',
    documentRoute({
      tag: 'Gateway',
      operationId: 'getGateway',
      permission: 'gateway:read',
      summary: 'Get gateway component status',
      response: GatewayStatus,
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      return c.json(gatewayStatus(snapshot, deps.config))
    },
  )

  // The diagnostics a container can make honestly. `portta doctor` stays
  // the deeper, host-level tool: it sees PATH, listening sockets, DNS and the
  // certificate files, which this process cannot.
  app.post(
    '/gateway/doctor',
    documentRoute({
      tag: 'Gateway',
      operationId: 'runGatewayDoctor',
      permission: 'gateway:read',
      summary: 'Run container-visible diagnostics',
      response: DoctorResponse,
      errors: [403, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get(true)
      // Traefik's verdict is worth a network call here, where the user asked for
      // diagnostics, and never on a page render.
      const verdict = await deps.verdict.get(true)
      const forge = await forgeStatus(deps.forge)
      const checks = [
        ...diagnose(snapshot, deps.config, verdict, [], deps.db.status(), loadAliases(deps.config), forge),
        ...(await moduleDiagnostics(deps, deps.modules ?? SERVER_MODULES)),
      ]
      return c.json({
        checks,
        failures: checks.filter((check) => check.status === 'fail').length,
        warnings: checks.filter((check) => check.status === 'warn').length,
        ranAt: Math.floor(Date.now() / 1000),
        hostCommand: './bin/portta doctor',
      })
    },
  )

  /**
   * Restarts gateway components in place. Traefik reads its static
   * configuration from the environment it was created with, so a settings
   * change still needs `portta up` on the host: the response says so
   * rather than pretending otherwise.
   */
  app.post(
    '/gateway/restart',
    documentRoute({
      tag: 'Gateway',
      operationId: 'restartGateway',
      permission: 'gateway:operate',
      summary: 'Restart selected gateway components',
      response: RestartResponse,
      request: restartBody,
      errors: [400, 403, 409, 500, 502],
    }),
    async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const parsed = restartBody.safeParse(body)
      if (!parsed.success) throw new HTTPException(400, { message: 'unknown restart request' })

      const wanted = parsed.data.components ?? ['traefik']
      const snapshot = await deps.cache.get(true)
      const restarted: string[] = []
      const missing: string[] = []

      for (const component of wanted) {
        const container = componentOf(snapshot, component)
        if (!container) {
          missing.push(component)
          continue
        }
        await deps.client.restart(container.id)
        restarted.push(component)
      }
      deps.cache.invalidate()

      if (restarted.length === 0) {
        throw new HTTPException(409, {
          message: `no running gateway component to restart (${missing.join(', ')})`,
        })
      }

      return c.json({
        ok: true,
        restarted,
        missing,
        note: 'settings saved in .env take effect once the containers are recreated',
        applyCommand: `./bin/portta up ${deps.config.profile}`,
      })
    },
  )

  /**
   * The state of the last apply, derived from the applier container itself and
   * never from this process's memory: applying recreates this process, so
   * anything held here is gone before there is a result to report.
   */
  app.get(
    '/gateway/apply',
    documentRoute({
      tag: 'Gateway',
      operationId: 'getApplyStatus',
      permission: 'gateway:read',
      summary: 'Get the state of the last settings apply',
      response: ApplyStatus,
      parameters: [
        {
          name: 'logs',
          in: 'query',
          required: false,
          description: "Include the tail of the applier's output. A failed apply always includes it.",
          schema: { type: 'string', enum: ['0', '1'], default: '0' },
        },
      ],
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      return c.json(await applyStatus(deps.client, snapshot, deps.config, { logs: c.req.query('logs') === '1' }))
    },
  )

  /**
   * Start the applier. It runs `portta up` on the host, which recreates this
   * panel: the response is written and flushed long before that happens, since
   * Docker returns from `start` as soon as the container is running and Compose
   * takes seconds to converge. The browser learns the outcome by polling
   * `/api/health` and this endpoint, not from this response.
   *
   * The panel sends no argument. There is nothing to send: the command was
   * fixed when the host created the container.
   */
  app.post(
    '/gateway/apply',
    documentRoute({
      tag: 'Gateway',
      operationId: 'applySettings',
      permission: 'gateway:operate',
      summary: 'Apply saved settings by starting the applier',
      response: ApplyResult,
      errors: [403, 404, 409, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get(true)
      const container = applier(snapshot)
      if (!container) {
        throw new ActionRefused(
          'this host has no applier',
          `set PORTTA_APPLY=true and run: ./bin/portta up ${deps.config.profile}`,
          404,
        )
      }

      const inspect = await deps.client.inspect(container.id)
      if (inspect.State.Running) {
        throw new ActionRefused('an apply is already running', 'watch it rather than starting a second one', 409)
      }

      try {
        await deps.client.start(container.id)
      } catch (cause) {
        // Docker answers 304 when the container started between the inspect above
        // and here — two tabs pressing the button at once. That is the same
        // situation as the check above, and must not surface as a 502.
        if (cause instanceof DockerApiError && cause.status === 304) {
          throw new ActionRefused('an apply is already running', 'watch it rather than starting a second one', 409)
        }
        throw cause
      }

      deps.cache.invalidate()
      await record(deps, c, {
        action: 'gateway.applied',
        resourceType: 'gateway',
        resourceId: container.id,
        resourceName: deps.config.profile,
      })
      return c.json({
        ok: true as const,
        startedAt: Math.floor(Date.now() / 1000),
        note: 'the gateway containers are being recreated; this panel goes offline for a few seconds',
        applyCommand: `./bin/portta up ${deps.config.profile}`,
      })
    },
  )

  /**
   * Traefik's own routing table. The panel links into the dashboard rather than
   * rebuilding it: this is the verdict, not a replacement view.
   */
  app.get(
    '/gateway/traefik',
    documentRoute({
      tag: 'Gateway',
      operationId: 'getTraefikVerdict',
      permission: 'gateway:read',
      summary: "Get Traefik's routing table",
      response: TraefikVerdict,
      errors: [500, 502],
    }),
    async (c) => c.json(await deps.verdict.get()),
  )

  app.get(
    '/gateway/logs',
    documentRoute({
      tag: 'Gateway',
      operationId: 'getGatewayLogs',
      permission: 'gateway:read',
      summary: 'Read gateway component logs',
      response: LogsResponse,
      parameters: [
        {
          name: 'component',
          in: 'query',
          required: false,
          description: 'Gateway component name.',
          schema: { type: 'string', enum: [...RESTARTABLE_COMPONENTS], default: 'traefik' },
        },
        tailParameter,
      ],
      errors: [400, 404, 500, 502],
    }),
    async (c) => {
      const component = c.req.query('component') ?? 'traefik'
      const allowed: readonly string[] = RESTARTABLE_COMPONENTS
      if (!allowed.includes(component)) {
        throw new HTTPException(400, { message: `unknown gateway component: ${component}` })
      }
      const snapshot = await deps.cache.get()
      const container = componentOf(snapshot, component)
      if (!container) throw new HTTPException(404, { message: `${component} is not running` })
      return c.json(await readLogs(deps, container.id, c.req.query('tail')))
    },
  )

  return app
}
