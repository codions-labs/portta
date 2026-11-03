import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { CrawlerPolicy, CrawlerSettings, ProjectCrawlers } from 'portta-contracts'
import { z } from 'portta-core/zod'
import { requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope, visible } from '../../services/access-control.ts'
import {
  NoEnvironmentsToCover,
  projectCrawlers,
  readDefaultCrawlers,
  saveDefaultCrawlers,
  saveProjectCrawlers,
} from '../../services/crawlers.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The Project slug, as created.',
  schema: { type: 'string' as const },
}

const ProjectBody = z
  .object({ policy: CrawlerPolicy.nullable().describe('null returns the project to the server default') })
  .strict()

export function crawlerRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function environmentsOf(projectId: string): Promise<string[]> {
    const rows = await requireDatabase(deps.db).projects.listEnvironments()
    return rows.filter((row) => row.projectId === projectId).map((row) => row.composeProject)
  }

  async function adoptedEnvironments(): Promise<Set<string>> {
    return new Set((await requireDatabase(deps.db).projects.listEnvironments()).map((row) => row.composeProject))
  }

  app.get(
    '/crawlers',
    documentRoute({
      tag: 'Shares',
      operationId: 'getCrawlers',
      permission: 'access:read',
      summary: 'Which crawlers may read the hostnames of this server',
      description:
        'The server default, which blocks every crawler until it is changed, and the projects that have an exception.',
      response: CrawlerSettings,
      errors: [403, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const exceptions: Array<{ project: string; name: string; policy: CrawlerPolicy | null; mixed: boolean }> = []
      for (const project of visible(principalOf(c), await db.projects.list(), (row) => projectScope(row.id))) {
        const state = projectCrawlers(deps.config, await environmentsOf(project.id))
        if (state.own || state.mixed) {
          exceptions.push({ project: project.slug, name: project.name, policy: state.own, mixed: state.mixed })
        }
      }
      return c.json({ default: readDefaultCrawlers(deps.config), exceptions })
    },
  )

  app.put(
    '/crawlers',
    documentRoute({
      tag: 'Shares',
      operationId: 'setDefaultCrawlers',
      permission: 'settings:manage',
      summary: 'Set which crawlers may read projects that have no exception',
      description: 'Takes effect on the next request. Nothing is restarted.',
      request: CrawlerPolicy,
      response: CrawlerPolicy,
      errors: [400, 403, 500],
    }),
    async (c) => {
      const policy = CrawlerPolicy.parse(await c.req.json())
      saveDefaultCrawlers(deps.config, policy, await adoptedEnvironments())
      await record(deps, c, {
        action: 'crawlers.changed',
        resourceType: 'settings',
        resourceName: 'default',
        metadata: { ...policy },
      })
      return c.json(policy)
    },
  )

  app.get(
    '/projects/:slug/crawlers',
    documentRoute({
      tag: 'Projects',
      operationId: 'getProjectCrawlers',
      permission: 'project:read',
      summary: 'Which crawlers may read the addresses of a project',
      response: ProjectCrawlers,
      parameters: [slugParameter],
      errors: [403, 404, 500, 503],
    }),
    async (c) => {
      const existing = await requireDatabase(deps.db).projects.find(c.req.param('slug'))
      if (!existing) throw new HTTPException(404, { message: `no project '${c.req.param('slug')}'` })
      authorizeScope(c, projectScope(existing.id))
      return c.json(projectCrawlers(deps.config, await environmentsOf(existing.id)))
    },
  )

  app.put(
    '/projects/:slug/crawlers',
    documentRoute({
      tag: 'Projects',
      operationId: 'setProjectCrawlers',
      permission: 'project:update',
      summary: 'Set an exception to the server default for one project',
      description:
        'Written to every environment the project has adopted. An environment adopted later follows the server default until this is saved again.',
      request: ProjectBody,
      response: ProjectCrawlers,
      parameters: [slugParameter],
      errors: [400, 403, 404, 409, 500, 503],
    }),
    async (c) => {
      const existing = await requireDatabase(deps.db).projects.find(c.req.param('slug'))
      if (!existing) throw new HTTPException(404, { message: `no project '${c.req.param('slug')}'` })
      authorizeScope(c, projectScope(existing.id))
      const body = ProjectBody.parse(await c.req.json())
      const environments = await environmentsOf(existing.id)
      try {
        saveProjectCrawlers(deps.config, environments, body.policy, await adoptedEnvironments())
      } catch (error) {
        if (error instanceof NoEnvironmentsToCover) throw new HTTPException(409, { message: error.message })
        throw error
      }
      await record(deps, c, {
        action: 'crawlers.changed',
        resourceType: 'project',
        resourceId: String(existing.id),
        resourceName: existing.slug,
        projectId: Number(existing.id),
        metadata: body.policy ? { ...body.policy } : { policy: 'default' },
      })
      return c.json(projectCrawlers(deps.config, environments))
    },
  )

  return app
}
