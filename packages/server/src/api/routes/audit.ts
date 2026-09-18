// Reading the audit log.
//
// One route, and deliberately no write: entries come from the services, after
// the write they record has succeeded. Nothing reaches this table through the
// API.

import { Hono } from 'hono'
import { AuditPage } from 'portta-contracts'
import { isAuditAction } from 'portta-core'
import type { AppDeps } from '../../deps.ts'
import { listAudit } from '../../services/audit.ts'
import { documentRoute } from '../openapi.ts'

const FILTERS = [
  ['limit', 'Up to 500; default 50.'],
  ['before', 'An entry id; only entries older than it, for paging.'],
  ['user', 'Only what this account did.'],
  ['project', 'Only what happened in this Project, by id.'],
  ['action', 'One of the closed action list.'],
] as const

export function auditRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get(
    '/audit',
    documentRoute({
      tag: 'Authentication',
      operationId: 'listAudit',
      permission: 'audit:read',
      summary: 'Who did what, newest first',
      description:
        'The sensitive writes only. Tasks, sessions and commits are development activity and live in /api/activity.',
      response: AuditPage,
      parameters: FILTERS.map(([name, description]) => ({
        name,
        in: 'query' as const,
        required: false,
        description,
        schema: { type: 'string' as const },
      })),
      errors: [401, 403, 500, 503],
    }),
    async (c) => {
      const query = new URL(c.req.url).searchParams
      const action = query.get('action')
      const project = query.get('project')
      return c.json(
        await listAudit(deps.db.handle, {
          ...(query.get('limit') && /^\d+$/.test(query.get('limit')!) ? { limit: Number(query.get('limit')) } : {}),
          ...(query.get('before') && /^\d+$/.test(query.get('before')!) ? { before: query.get('before')! } : {}),
          ...(query.get('user') ? { userId: query.get('user')! } : {}),
          ...(project && /^\d+$/.test(project) ? { projectId: Number(project) } : {}),
          ...(action && isAuditAction(action) ? { action } : {}),
        }),
      )
    },
  )

  return app
}
