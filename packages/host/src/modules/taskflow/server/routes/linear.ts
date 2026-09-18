import type { Hono } from 'hono'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { buildLinearIssuesResponse, fetchAssignedIssues } from '../../services/linear-service.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter, worktreeName } from './project-router.ts'

export function linearRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchLinearIssues', 'Linear', async ({ runtime: { config } }) => {
    const apiKey = process.env.LINEAR_API_KEY
    const fetchResult = config.integrations.linear.enabled && apiKey?.trim() ? await fetchAssignedIssues() : undefined
    const result = buildLinearIssuesResponse({
      integrationEnabled: config.integrations.linear.enabled,
      apiKey,
      fetchResult,
    })
    if (!result.ok) return errorResponse(result.error, 502)
    return jsonResponse(result.data)
  })

  projectRoute(app, deps, 'setLinearAutoCreate', 'Linear', async (project, { body }) =>
    jsonResponse({ ok: true, enabled: await project.setLinearAutoCreateEnabled(body.enabled) }),
  )

  projectRoute(app, deps, 'postWorktreeToLinear', 'Linear', async (project, { params, body }) => {
    const name = worktreeName(params.name)
    if (name instanceof Response) return name
    const outcome = await project.postWorktreeConversationToLinear(name, body.target)
    if (!outcome.ok) return errorResponse(outcome.error, outcome.status)
    return jsonResponse({
      ok: true,
      issueId: outcome.data.issueId,
      issueUrl: outcome.data.issueUrl,
      commentUrl: outcome.data.commentUrl,
      attachmentUrl: outcome.data.attachmentUrl,
    })
  })

  return app
}
