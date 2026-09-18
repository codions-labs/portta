// The development surfaces: the consolidated Service of an environment, the
// Development Context an agent reads before it works, a Project's attributed
// resources, and the Development Dashboard.
//
// Nothing here is a new source of truth. Each route reads what the others
// already read — the snapshot, the catalog, the tasks, the scans, the metrics
// — and hands it to a pure presenter in core/, where the shape is tested.

import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import type { Environment, Project } from 'portta-contracts'
import {
  ActionResult,
  DevelopmentContext,
  DevelopmentOverview,
  EnvironmentServices,
  ProjectResources,
} from 'portta-contracts'
import { parseIssueRef } from 'portta-core'
import { taskflowModule } from 'portta-core/modules'
import { z } from 'portta-core/zod'
import { type Database, requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { SERVER_MODULES } from '../../modules/index.ts'
import { projectHostPaths, servesPath } from '../../modules/taskflow/scope.ts'
import {
  fetchTaskflowWorktrees,
  readTaskflowRegistry,
  type TaskflowWorktree,
} from '../../modules/taskflow/worktrees.ts'
import { listBridges } from '../../services/access.ts'
import { projectOfEnvironment, projectScope } from '../../services/access-control.ts'
import { runContainerAction } from '../../services/actions.ts'
import { recordActivity } from '../../services/activity.ts'
import { buildContext } from '../../services/context-view.ts'
import { developmentOverview, listProjects, scansFor } from '../../services/development.ts'
import { coordinateFor } from '../../services/issues/provider.ts'
import { keyOfRef, readIssue, workFactsFor } from '../../services/issues/read.ts'
import { readCurrentMetrics } from '../../services/metrics.ts'
import { applyOverrides, loadOverrides } from '../../services/overrides.ts'
import { findRememberedEnvironment } from '../../services/remembered.ts'
import { environmentServices } from '../../services/service-view.ts'
import { record } from '../audit.ts'
import { documentRoute, projectParameter } from '../openapi.ts'

/**
 * The worktrees of every Taskflow Project that serves one of this Project's
 * directories. Off when the module is, and "unknown" — not "none" — when the
 * daemon does not answer: the context says which, so an agent does not read
 * an empty list as a fact.
 */
async function worktreesFor(
  deps: AppDeps,
  project: Project,
): Promise<{ enabled: boolean; reachable: boolean; worktrees: TaskflowWorktree[] }> {
  const mounted = (deps.modules ?? SERVER_MODULES).some((module) => module.manifest.id === taskflowModule.id)
  const enabled = mounted && deps.config.hostUrl !== null
  if (!enabled) return { enabled: false, reachable: false, worktrees: [] }
  const hostPaths = projectHostPaths(project.resolvedPath, project.repositories)
  const registry = await readTaskflowRegistry(deps.config)
  if (!registry.reachable) return { enabled, reachable: false, worktrees: [] }
  const served = registry.projects.filter((directory) => servesPath(hostPaths, directory.path))
  const answers = await Promise.all(served.map((directory) => fetchTaskflowWorktrees(deps.config, directory)))
  return {
    enabled,
    reachable: answers.every((answer) => answer.reachable),
    worktrees: answers.flatMap((answer) => answer.worktrees),
  }
}

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The Project slug.',
  schema: { type: 'string' as const },
}
const serviceParameter = {
  name: 'service',
  in: 'path' as const,
  required: true,
  description: 'Compose service name.',
  schema: { type: 'string' as const },
}
const ServiceAction = z.enum(['start', 'stop', 'restart'])

export function developmentRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function environmentNamed(name: string): Promise<Environment> {
    const snapshot = await deps.cache.get()
    // A remembered environment (containers gone, row kept) answers too, with
    // no services: the page renders it with its start-or-forget choice.
    const found =
      snapshot.environments.find((item) => item.name === name) ??
      (await findRememberedEnvironment(deps.db, snapshot, deps.config, name))
    if (!found) throw new HTTPException(404, { message: `no environment '${name}' is running` })
    return applyOverrides([found], await loadOverrides(deps.db))[0]!
  }

  const projects = (db: Database): Promise<Project[]> => listProjects(deps, db)

  async function projectNamed(c: Context, db: Database, slug: string): Promise<Project> {
    const project = (await projects(db)).find((item) => item.slug === slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    authorizeScope(c, projectScope(project.id))
    return project
  }

  /** Whether this caller reaches the environment a route named. */
  async function reach(c: Context, name: string): Promise<void> {
    authorizeScope(c, await projectOfEnvironment(deps.db, name))
  }

  // --- the consolidated Service ---------------------------------------------

  app.get(
    '/environments/:project/services',
    documentRoute({
      tag: 'Environments',
      operationId: 'listEnvironmentServices',
      permission: 'service:read',
      summary: 'The services of one environment, consolidated',
      description:
        'Each service with its state, health, access (endpoints, bridge, primary address), resources from the host collector, runtime and the actions that apply, in one row.',
      response: EnvironmentServices,
      parameters: [projectParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      await reach(c, c.req.param('project'))
      const environment = await environmentNamed(c.req.param('project'))
      const snapshot = await deps.cache.get()
      const readOnly = !principalOf(c).permissions.has('environment:operate')
      return c.json(
        environmentServices(environment, deps.config, readCurrentMetrics(deps.config), listBridges(snapshot), {
          readOnly,
        }),
      )
    },
  )

  app.post(
    '/environments/:project/services/:service/actions/:action',
    documentRoute({
      tag: 'Environments',
      operationId: 'runServiceAction',
      permission: 'service:operate',
      summary: 'Start, stop or restart one service of an environment',
      description:
        'Resolves the service to its container and runs the same guarded action the Docker endpoints run. Gateway components are refused.',
      response: ActionResult,
      parameters: [
        projectParameter,
        serviceParameter,
        { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: [...ServiceAction.options] } },
      ],
      errors: [400, 403, 404, 409, 500, 502],
    }),
    async (c) => {
      const action = ServiceAction.safeParse(c.req.param('action'))
      if (!action.success)
        throw new HTTPException(400, { message: `'${c.req.param('action')}' is not start, stop or restart` })
      await reach(c, c.req.param('project'))
      const environment = await environmentNamed(c.req.param('project'))
      const name = c.req.param('service')
      const target = environment.services.find((service) => (service.service ?? service.name) === name)
      if (!target) throw new HTTPException(404, { message: `no service '${name}' in '${environment.name}'` })
      const snapshot = await deps.cache.get()
      const container = await runContainerAction(deps.client, snapshot, target.id, action.data)
      deps.cache.invalidate()
      const principal = principalOf(c)
      const db = deps.db
      if (db) {
        const environmentRow = await db.environments.find(environment.name).catch(() => null)
        await recordActivity(deps, {
          kind:
            action.data === 'start'
              ? 'environment.started'
              : action.data === 'stop'
                ? 'environment.stopped'
                : 'environment.restarted',
          summary: `${name} of ${environment.name}: ${action.data}`,
          actor: principal.actor,
          actorKind: principal.actorKind,
          environmentId: environmentRow?.id ?? null,
          data: { service: name, container: container.name },
        })
      }
      // Only the restart is an audit line: starting and stopping one service of
      // an environment is the environment's own lifecycle, already recorded
      // there, and `service.restarted` is the action the audit vocabulary names.
      if (action.data === 'restart') {
        await record(deps, c, {
          action: 'service.restarted',
          resourceType: 'service',
          resourceId: container.id,
          resourceName: `${environment.name}/${name}`,
        })
      }
      return c.json({
        ok: true,
        action: action.data,
        containerId: container.id,
        message: `${action.data} sent to ${container.name}`,
      })
    },
  )

  // --- the Development Context ------------------------------------------------

  app.get(
    '/projects/:slug/context',
    documentRoute({
      tag: 'Projects',
      operationId: 'getProjectContext',
      permission: 'project:read',
      summary: 'The Development Context of a project, for an agent about to work',
      description:
        'The project, its repositories with their git state and instruction files, the environments with their services and commands, the effective instructions, and the CLI verbs that matter. Name an issue with ?issue=github:owner/repo%23113 to include it in full, body and comments.',
      response: DevelopmentContext,
      parameters: [
        slugParameter,
        {
          name: 'issue',
          in: 'query',
          required: false,
          description: 'An issue ref to include in full, such as github:owner/repo#113.',
          schema: { type: 'string' },
        },
      ],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const project = await projectNamed(c, db, c.req.param('slug'))
      const snapshot = await deps.cache.get()
      const overrides = await loadOverrides(deps.db)
      const adopted = new Set(project.environments.map((link) => link.environment))
      const environments = applyOverrides(
        snapshot.environments.filter((environment) => adopted.has(environment.name)),
        overrides,
      )
      const metrics = readCurrentMetrics(deps.config)
      const bridges = listBridges(snapshot)
      const principal = principalOf(c)
      const services = new Map(
        environments.map((environment) => [
          environment.name,
          environmentServices(environment, deps.config, metrics, bridges, {
            readOnly: !principal.permissions.has('environment:operate'),
          }),
        ]),
      )

      // The issue is read from its provider, and a provider that is unreachable
      // is not a 502 here: the context is what an agent needs to start work, and
      // the repositories, environments and instructions in it are still true.
      const requested = c.req.query('issue')
      let issue = null
      if (requested) {
        if (!parseIssueRef(requested)) throw new HTTPException(400, { message: `not an issue reference: ${requested}` })
        const record = await db.projects.find(project.slug)
        const key = keyOfRef(requested)
        if (record && key) {
          try {
            const facts = await workFactsFor(db, record)
            issue = await readIssue(deps, db, facts, coordinateFor(facts), key)
          } catch {
            // The context is what an agent needs to start work, and the rest of
            // it is still true when the provider is not answering.
            issue = null
          }
        }
      }
      const taskflow = await worktreesFor(deps, project)
      return c.json(
        buildContext({
          now: Date.now(),
          actor: principal.actor,
          permissions: [...principal.permissions].sort(),
          project,
          issue,
          scans: scansFor(deps, [project]),
          environments,
          services,
          worktrees: taskflow.worktrees,
          taskflow: { enabled: taskflow.enabled, reachable: taskflow.reachable },
        }),
      )
    },
  )

  // --- attributed resources ---------------------------------------------------

  app.get(
    '/projects/:slug/resources',
    documentRoute({
      tag: 'Projects',
      operationId: 'getProjectResources',
      permission: 'metrics:read',
      summary: "A project's resource usage, attributed through its environments",
      description:
        'Host → Project → Environment → Container, summed from the collector over the environments this project adopted. Unattributed usage is not counted here.',
      response: ProjectResources,
      parameters: [slugParameter],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const project = await projectNamed(c, db, c.req.param('slug'))
      const metrics = readCurrentMetrics(deps.config)
      const adopted = new Set(project.environments.map((link) => link.environment))
      const environments = metrics.projects
        .filter((measured) => adopted.has(measured.composeProject))
        .map((measured) => ({
          environment: measured.composeProject,
          project: project.slug,
          cpuUtilisation: measured.cpuUtilisation,
          memoryUsedBytes: measured.memoryUsedBytes,
          containerCount: measured.containerCount,
          containers: measured.containers.map((container) => ({
            id: container.id,
            name: container.name,
            service: container.service,
            cpuUtilisation: container.cpuUtilisation,
            memoryUsedBytes: container.memoryUsedBytes,
            memoryLimitBytes: container.memoryLimitBytes,
          })),
        }))
      const sum = (pick: (e: (typeof environments)[number]) => number | null) => {
        const values = environments.map(pick).filter((v): v is number => v !== null)
        return values.length === 0 ? null : values.reduce((a, b) => a + b, 0)
      }
      return c.json({
        project: project.slug,
        collectedAt: metrics.collectedAt,
        stale: metrics.stale,
        collectorActive: metrics.collectorActive,
        cpuUtilisation: sum((e) => e.cpuUtilisation),
        memoryUsedBytes: sum((e) => e.memoryUsedBytes),
        hostMemoryTotalBytes: metrics.host?.memoryTotalBytes ?? null,
        environments,
      })
    },
  )

  // --- the Development Dashboard ----------------------------------------------

  app.get(
    '/overview',
    documentRoute({
      tag: 'Status',
      operationId: 'getDevelopmentOverview',
      permission: 'project:read',
      summary: 'The Development Dashboard: what is happening on this host',
      description:
        'Work in progress, active sessions, what needs attention, each project at a glance, recent code, the runtime and the resources. Without a database the work, session and project sections are empty and everything else still answers.',
      response: DevelopmentOverview,
      errors: [500, 502],
    }),
    async (c) => c.json(await developmentOverview(deps, principalOf(c))),
  )

  return app
}
