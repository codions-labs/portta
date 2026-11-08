import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Principal } from 'portta-auth-core'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import {
  Environment,
  EnvironmentActionResult,
  EnvironmentRemovalPreview,
  EnvironmentRunnerStartResult,
  type ProjectLogSource,
  ProjectLogsResponse,
  ProjectRebuildResult,
  ProjectRemoveResult,
} from 'portta-contracts'
import { z } from 'portta-core/zod'
import { requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { adoptions, projectOfEnvironment, visible } from '../../services/access-control.ts'
import { ActionRefused, runProjectAction } from '../../services/actions.ts'
import { type AuditAction, audit } from '../../services/audit.ts'
import type { Snapshot } from '../../services/inventory.ts'
import { dispatchRunner, projectRemovalPreview, rebuildProject, removeProject } from '../../services/operations.ts'
import { aliasViewFor, applyOverrides, loadOverrides } from '../../services/overrides.ts'
import { type LogSourceLines, mergeLogSources } from '../../services/projectlogs.ts'
import { composeUpCommand, findRememberedEnvironment, rememberedEnvironments } from '../../services/remembered.ts'
import { runnerOf } from '../../services/runner.ts'
import { documentRoute, projectParameter, tailParameter } from '../openapi.ts'

export const EnvironmentsResponse = z
  .object({ environments: z.array(Environment) })
  .strict()
  .meta({ ref: 'EnvironmentsResponse' })
export const EnvironmentForgotten = z
  .object({ ok: z.literal(true), forgotten: z.string() })
  .strict()
  .meta({ ref: 'EnvironmentForgotten' })

/** Per source, and overall: a ten-service project cannot ask for 20 000 lines. */
const MAX_TAIL = 2000
const DEFAULT_TAIL = 200
const AGGREGATE_DEFAULT_TAIL = 100

function clampTail(requested: string | undefined, fallback: number): number {
  const value = Number(requested ?? String(fallback))
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), MAX_TAIL)
}

/**
 * Which lifecycle operations are also audit entries.
 *
 * Every one of them: an environment's lifecycle is a change to what is running
 * on the host, which is the definition of what this log is for. The operation
 * says `removed` where the audit list says `destroyed`, so the mapping is
 * written out.
 */
const ENVIRONMENT_AUDIT = {
  'environment.started': 'environment.started',
  'environment.stopped': 'environment.stopped',
  'environment.restarted': 'environment.restarted',
  'environment.rebuilt': 'environment.rebuilt',
  'environment.removed': 'environment.destroyed',
  'environment.forgotten': 'environment.forgotten',
} as const satisfies Record<string, AuditAction>

type EnvironmentOperation = keyof typeof ENVIRONMENT_AUDIT

/**
 * One audit line per lifecycle operation, attributed to the Project that
 * adopted the environment when one did.
 *
 * Here rather than in the service: `runProjectAction` and `removeProject` are
 * Docker calls with no database in them, so the route records the line.
 */
async function auditEnvironment(
  deps: AppDeps,
  name: string,
  principal: Principal,
  kind: EnvironmentOperation,
): Promise<void> {
  const db = deps.db
  if (!db.status().available) return
  const environment = await db.environments.find(name).catch(() => null)
  const adoption = environment
    ? (await db.projects.listEnvironments().catch(() => [])).find(
        (row) => row.composeProject === environment.composeProject,
      )
    : undefined
  await audit(db.handle, principal, {
    action: ENVIRONMENT_AUDIT[kind],
    resourceType: 'environment',
    resourceId: environment?.id ?? null,
    resourceName: name,
    projectId: adoption ? Number(adoption.projectId) : null,
  })
}

const RemoveBody = z.object({ confirmation: z.string(), volumes: z.boolean() }).strict()

export function environmentRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * Whether this caller reaches the environment a route named.
   *
   * An environment belongs to whichever Project adopted it; one nothing adopted
   * belongs to nobody, and is for `scope: 'all'` alone.
   */
  async function reach(c: Context, name: string): Promise<void> {
    authorizeScope(c, await projectOfEnvironment(deps.db, name))
  }

  // Integrated environments are the ones with at least one service on the
  // gateway. Everything else lives on the Docker page, where it
  // is clearly labelled as being outside the gateway.
  app.get(
    '/environments',
    documentRoute({
      tag: 'Environments',
      operationId: 'listEnvironments',
      permission: 'environment:read',
      summary: 'List Compose environments',
      response: EnvironmentsResponse,
      description:
        'Live environments (with containers) and, when the panel has persistence, remembered ones (seen before, containers gone). Without ?all the list is the integrated live ones plus the remembered ones a Project adopted.',
      parameters: [
        {
          name: 'all',
          in: 'query',
          required: false,
          description: 'Include environments that have not adopted the gateway, and every remembered one.',
          schema: { type: 'boolean', default: false },
        },
      ],
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const all = c.req.query('all') === 'true'
      // A remembered environment has no containers, so it is never integrated.
      // The default list still shows the ones a Project adopted by hand: the
      // Project page would otherwise lose an environment the moment it was
      // taken down, which is the opposite of what "remembered" is for.
      const remembered = await rememberedEnvironments(deps.db, snapshot, deps.config)
      const adopted =
        all || remembered.length === 0
          ? new Set<string>()
          : new Set((await deps.db!.projects.listEnvironments().catch(() => [])).map((row) => row.composeProject))
      const environments = all
        ? [...snapshot.environments, ...remembered]
        : [
            ...snapshot.environments.filter((environment) => environment.integrated),
            ...remembered.filter((environment) => adopted.has(environment.name)),
          ]
      // With no database, or none reachable, `applyOverrides` is the identity
      // function and the response is byte-identical to a panel with no
      // persistence at all.
      const decorated = applyOverrides(environments, await loadOverrides(deps.db), aliasViewFor(deps.config))
      // Then filtered: a developer sees the environments their Projects adopted,
      // and an environment nobody adopted is for whoever sees everything.
      const owners = await adoptions(deps.db)
      return c.json({
        environments: visible(principalOf(c), decorated, (environment) => owners.get(environment.name) ?? null),
      })
    },
  )

  app.get(
    '/environments/:project',
    documentRoute({
      tag: 'Environments',
      operationId: 'getEnvironment',
      permission: 'environment:read',
      summary: 'Get one environment, live or remembered',
      response: Environment,
      description:
        'A remembered environment (containers gone, row kept) answers with no services and presence: remembered.',
      parameters: [projectParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const name = c.req.param('project')
      const project =
        snapshot.environments.find((item) => item.name === name) ??
        (await findRememberedEnvironment(deps.db, snapshot, deps.config, name))
      if (!project) throw new HTTPException(404, { message: `no environment '${name}' is running` })
      await reach(c, name)
      const decorated = applyOverrides([project], await loadOverrides(deps.db), aliasViewFor(deps.config))[0]!
      return c.json(decorated)
    },
  )

  /**
   * Every service of a project, interleaved.
   *
   * One unreadable container must not blank the four that answered, so sources
   * are read concurrently and a failure is reported *in* the response rather
   * than thrown. An unknown project is still a 404; a known project whose
   * sources all failed is a 200 carrying the reasons.
   */
  app.get(
    '/environments/:project/logs',
    documentRoute({
      tag: 'Environments',
      operationId: 'getProjectLogs',
      permission: 'logs:read',
      summary: "Read every service's recent logs",
      response: ProjectLogsResponse,
      description:
        'Reads each service concurrently. A source that could not be read is reported beside the sources that answered.',
      parameters: [
        projectParameter,
        tailParameter,
        {
          name: 'service',
          in: 'query',
          required: false,
          description: 'Restrict the read to one Compose service.',
          schema: { type: 'string' },
        },
      ],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const name = c.req.param('project')
      const project =
        snapshot.environments.find((item) => item.name === name) ??
        (await findRememberedEnvironment(deps.db, snapshot, deps.config, name))
      if (!project) throw new HTTPException(404, { message: `no environment '${name}' is running` })
      await reach(c, name)

      const wanted = c.req.query('service')
      const services = project.services.filter(
        (service) => wanted === undefined || (service.service ?? service.name) === wanted,
      )
      const aggregating = services.length > 1
      const tail = clampTail(c.req.query('tail'), aggregating ? AGGREGATE_DEFAULT_TAIL : DEFAULT_TAIL)

      const reads = await Promise.allSettled(services.map((service) => deps.client.logs(service.id, { tail })))

      const sources: ProjectLogSource[] = []
      const collected: LogSourceLines[] = []

      services.forEach((service, index) => {
        const label = service.service ?? service.name
        const result = reads[index]!
        const lines = result.status === 'fulfilled' ? result.value : []
        if (result.status === 'fulfilled') collected.push({ service: label, lines })
        sources.push({
          containerId: service.id,
          service: label,
          name: service.name,
          state: service.state,
          lineCount: lines.length,
          truncated: lines.length >= tail,
          error:
            result.status === 'rejected'
              ? `could not read logs: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
              : null,
        })
      })

      const merged = mergeLogSources(collected, MAX_TAIL)
      return c.json({
        project: project.name,
        sources,
        lines: merged.lines,
        truncated: merged.truncated || sources.some((source) => source.truncated),
        ordered: merged.ordered,
      })
    },
  )

  app.get(
    '/environments/:project/removal-preview',
    documentRoute({
      tag: 'Environments',
      operationId: 'previewEnvironmentRemoval',
      permission: 'environment:read',
      summary: 'Preview what removing this environment from this host would touch',
      description: 'Advisory. Nothing is removed. Volume sizes are null: the panel has no volume inspect.',
      response: EnvironmentRemovalPreview,
      parameters: [projectParameter],
      errors: [403, 404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      await reach(c, c.req.param('project'))
      return c.json(await projectRemovalPreview(snapshot, deps.config, deps.db, c.req.param('project')))
    },
  )

  app.post(
    '/environments/:project/operations/rebuild',
    documentRoute({
      tag: 'Environments',
      operationId: 'rebuildProject',
      permission: 'environment:operate',
      summary: 'Rebuild this project through the runner',
      description: 'Writes a closed runner request and starts the prepared container. Volumes are preserved.',
      response: ProjectRebuildResult,
      parameters: [projectParameter],
      request: z.object({ noCache: z.boolean().optional() }).strict(),
      errors: [400, 403, 404, 409, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const body = (await c.req.json().catch(() => ({}))) as { noCache?: boolean }
      await reach(c, c.req.param('project'))
      const rebuildResult = await rebuildProject(deps.client, snapshot, deps.config, c.req.param('project'), {
        noCache: body.noCache === true,
      })
      deps.cache.invalidate()
      await auditEnvironment(deps, c.req.param('project'), principalOf(c), 'environment.rebuilt')
      return c.json(rebuildResult)
    },
  )

  app.post(
    '/environments/:project/operations/remove',
    documentRoute({
      tag: 'Environments',
      operationId: 'removeProject',
      permission: 'environment:destroy',
      summary: 'Remove this project from this host',
      description:
        'Confirmation is the exact Compose project name, checked on the server. The working directory is never removed.',
      response: ProjectRemoveResult,
      parameters: [projectParameter],
      request: RemoveBody,
      errors: [400, 403, 404, 409, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const body = RemoveBody.parse(await c.req.json())
      await reach(c, c.req.param('project'))
      const result = await removeProject(deps.client, snapshot, deps.config, deps.db, c.req.param('project'), body)
      deps.cache.invalidate()
      await auditEnvironment(deps, c.req.param('project'), principalOf(c), 'environment.removed')
      return c.json(result)
    },
  )

  /**
   * Start with nothing to iterate: the containers are gone and the row
   * remembers where Compose ran. The runner gets an `up` that carries the
   * working directory and the Compose files, because there is no container
   * left to read labels from. Without the runner the answer is the command.
   */
  async function startRemembered(
    principal: Principal,
    snapshot: Snapshot,
    name: string,
  ): Promise<EnvironmentRunnerStartResult | null> {
    if (snapshot.environments.some((item) => item.name === name)) return null
    const remembered = await findRememberedEnvironment(deps.db, snapshot, deps.config, name)
    if (!remembered) return null
    if (name === deps.config.projectName) {
      throw new ActionRefused(`refusing to start ${name}: it is Portta's own project`, 'run portta up on the host', 403)
    }
    if (!remembered.operable.ok || !remembered.workingDir) {
      throw new ActionRefused(
        remembered.operable.reason ?? 'this environment is not operable',
        'without a working directory the panel cannot say where Compose should run; forget it, or start it on the host',
        409,
      )
    }
    const configFiles = remembered.operable.configFiles
    if (!runnerOf(snapshot)) {
      throw new ActionRefused(
        `${name} has no containers on this host and the runner is not available`,
        composeUpCommand(name, remembered.workingDir, configFiles),
        409,
      )
    }
    const runner = await dispatchRunner(deps.client, snapshot, deps.config, {
      verb: 'up',
      project: name,
      workingDir: remembered.workingDir,
      configFiles,
    })
    deps.cache.invalidate()
    await auditEnvironment(deps, name, principal, 'environment.started')
    return { ok: true, project: name, action: 'start', via: 'runner', runner }
  }

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(
      `/environments/:project/actions/${action}`,
      documentRoute({
        tag: 'Environments',
        operationId: `${action}Environment`,
        permission: 'environment:operate',
        summary: `${action[0]?.toUpperCase()}${action.slice(1)} every container in an environment`,
        description:
          action === 'start'
            ? "Iterates the environment's existing containers in Compose dependency order. A remembered environment (no containers) is started through the runner with Compose up, or refused with the command to run on the host."
            : "Iterates the environment's existing containers in Compose dependency order. Nothing is removed.",
        response:
          action === 'start'
            ? z.union([EnvironmentActionResult, EnvironmentRunnerStartResult])
            : EnvironmentActionResult,
        parameters: [projectParameter],
        errors: [403, 404, 409, 500, 502],
      }),
      async (c) => {
        const snapshot = await deps.cache.get()
        await reach(c, c.req.param('project'))
        if (action === 'start') {
          const viaRunner = await startRemembered(principalOf(c), snapshot, c.req.param('project'))
          if (viaRunner) return c.json(viaRunner)
        }
        const result = await runProjectAction(deps.client, snapshot, c.req.param('project'), action)
        deps.cache.invalidate()
        await auditEnvironment(
          deps,
          c.req.param('project'),
          principalOf(c),
          action === 'start'
            ? 'environment.started'
            : action === 'stop'
              ? 'environment.stopped'
              : 'environment.restarted',
        )
        return c.json(result)
      },
    )
  }

  app.delete(
    '/environments/:project',
    documentRoute({
      tag: 'Environments',
      operationId: 'forgetEnvironment',
      permission: 'environment:destroy',
      summary: 'Forget a remembered environment',
      description:
        "Drops the panel's row for an environment whose containers are already gone: its overrides, Project link and task links go with it. A live environment is refused: stop and remove it first. Nothing on the host is touched.",
      response: EnvironmentForgotten,
      parameters: [projectParameter],
      errors: [403, 404, 409, 500, 503],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const name = c.req.param('project')
      if (snapshot.environments.some((item) => item.name === name)) {
        throw new ActionRefused(
          `${name} is live on this host`,
          'stop and remove it first; forgetting is for an environment whose containers are gone',
          409,
        )
      }
      const db = requireDatabase(deps.db)
      const remembered = await findRememberedEnvironment(db, snapshot, deps.config, name)
      if (!remembered) throw new HTTPException(404, { message: `no environment '${name}' is remembered` })
      await reach(c, name)
      await auditEnvironment(deps, name, principalOf(c), 'environment.forgotten')
      await db.environments.forget(name)
      deps.cache.invalidate()
      return c.json({ ok: true as const, forgotten: name })
    },
  )

  return app
}
