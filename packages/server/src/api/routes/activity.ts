// What happened, for one Project or for the whole Node.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Principal } from 'portta-auth-core'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { ActivityEvent } from 'portta-contracts'
import { isActivityKind } from 'portta-core'
import { z } from 'portta-core/zod'
import { type Database, requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope, visible } from '../../services/access-control.ts'
import { activityView, loadNames } from '../../services/activity-view.ts'
import { documentRoute } from '../openapi.ts'

const ActivityResponse = z
  .object({ events: z.array(ActivityEvent) })
  .strict()
  .meta({ ref: 'ActivityResponse' })

const FILTERS = [
  ['kind', 'Comma-separated event kinds, for example issue.state,session.started.'],
  ['issue', 'Issue ref, such as github:owner/repo#113.'],
  ['repository', 'Repository id.'],
  ['environment', 'COMPOSE_PROJECT_NAME.'],
  ['session', 'Session id.'],
  ['since', 'Unix seconds; only events at or after this moment.'],
  ['before', 'An event id; only events older than it, for paging.'],
  ['limit', 'Up to 500; default 50.'],
] as const
const filterParameters = FILTERS.map(([name, description]) => ({
  name,
  in: 'query' as const,
  required: false,
  description,
  schema: { type: 'string' as const },
}))

export function activityRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function listing(principal: Principal, db: Database, projectId: string | undefined, query: URLSearchParams) {
    const kinds = query.get('kind')?.split(',').filter(isActivityKind)
    const environment = query.get('environment')
    const environmentId = environment ? ((await db.environments.find(environment))?.id ?? '0') : undefined
    const since = query.get('since')
    const rows = await db.activity.list({
      ...(projectId ? { projectId } : {}),
      ...(kinds && kinds.length > 0 ? { kinds } : {}),
      ...(query.get('issue') ? { issueRef: query.get('issue')! } : {}),
      ...(query.get('repository') ? { repositoryId: query.get('repository')! } : {}),
      ...(environmentId ? { environmentId } : {}),
      ...(query.get('session') ? { sessionId: query.get('session')! } : {}),
      ...(since && /^\d+$/.test(since) ? { since: new Date(Number(since) * 1000) } : {}),
      ...(query.get('before') && /^\d+$/.test(query.get('before')!) ? { before: query.get('before')! } : {}),
      ...(query.get('limit') && /^\d+$/.test(query.get('limit')!) ? { limit: Number(query.get('limit')) } : {}),
    })
    const names = await loadNames(db)
    // Filtered before it is rendered, and by the row's own `project_id`: an
    // event with none is about the host — a setting, the gateway — and belongs
    // to whoever sees everything (ADR 0038).
    return visible(principal, rows, (row) => projectScope(row.projectId)).map((row) => activityView(names, row))
  }

  app.get(
    '/projects/:slug/activity',
    documentRoute({
      tag: 'Activity',
      operationId: 'listProjectActivity',
      permission: 'activity:read',
      summary: "A Project's activity, newest first",
      response: ActivityResponse,
      parameters: [
        { name: 'slug', in: 'path', required: true, description: 'The Project slug.', schema: { type: 'string' } },
        ...filterParameters,
      ],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const project = await db.projects.find(c.req.param('slug'))
      if (!project) throw new HTTPException(404, { message: `no project '${c.req.param('slug')}'` })
      const principal = authorizeScope(c, projectScope(project.id))
      return c.json({ events: await listing(principal, db, project.id, new URL(c.req.url).searchParams) })
    },
  )

  app.get(
    '/activity',
    documentRoute({
      tag: 'Activity',
      operationId: 'listActivity',
      permission: 'activity:read',
      summary: 'Activity across every Project, newest first',
      response: ActivityResponse,
      parameters: filterParameters,
      errors: [500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      return c.json({ events: await listing(principalOf(c), db, undefined, new URL(c.req.url).searchParams) })
    },
  )

  app.get(
    '/projects/:slug/issues/:ref/activity',
    documentRoute({
      tag: 'Activity',
      operationId: 'listIssueActivity',
      permission: 'activity:read',
      summary: 'What Portta did to one issue, newest first',
      description:
        'Only what Portta itself did. An issue edited in a browser leaves no row here: there is no webhook and no ' +
        'mirror, so this is a record of this panel’s writes rather than a history of the issue (ADR 0018).',
      response: ActivityResponse,
      parameters: [
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        {
          name: 'ref',
          in: 'path',
          required: true,
          description: 'An issue ref, such as github:owner/repo#113.',
          schema: { type: 'string' },
        },
        ...filterParameters.filter((entry) => entry.name !== 'issue'),
      ],
      errors: [400, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const project = await db.projects.find(c.req.param('slug'))
      if (!project) throw new HTTPException(404, { message: `no project '${c.req.param('slug')}'` })
      const principal = authorizeScope(c, projectScope(project.id))
      const query = new URL(c.req.url).searchParams
      query.set('issue', decodeURIComponent(c.req.param('ref')))
      return c.json({ events: await listing(principal, db, project.id, query) })
    },
  )

  return app
}
