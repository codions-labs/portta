import { Hono } from 'hono'
import { authorize } from 'portta-auth-core'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { HttpIntegrationOperation, HttpIntegrationResult } from 'portta-contracts'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import { projectOfEnvironment } from '../../services/access-control.ts'
import { beginHttpIntegration, httpIntegrationStatus } from '../../services/http-integration.ts'
import { documentRoute, projectParameter } from '../openapi.ts'

const serviceParameter = { name: 'service', in: 'path' as const, required: true, schema: { type: 'string' as const } }
const requestBody = z
  .object({ alias: z.string().min(1).max(253), port: z.number().int().min(1).max(65535) })
  .strict()
  .meta({ ref: 'HttpIntegrationBody' })

export function httpIntegrationRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  app.post(
    '/environments/:project/services/:service/http-integration',
    documentRoute({
      tag: 'Environments',
      operationId: 'integrateServiceHttp',
      permission: 'environment:settings',
      summary: 'Prepare one service for an HTTP address',
      description:
        'Adds a generated Compose attachment and recreates only the chosen service. No hostname is activated by this operation.',
      request: requestBody,
      response: HttpIntegrationResult,
      parameters: [projectParameter, serviceParameter],
      errors: [400, 403, 404, 409, 500, 502],
    }),
    async (c) => {
      const body = requestBody.parse(await c.req.json())
      const project = c.req.param('project')
      const projectId = await projectOfEnvironment(deps.db, project)
      authorizeScope(c, projectId)
      authorize(principalOf(c), 'environment:operate', { projectId })
      if (deps.config.profile === 'remote-public') authorize(principalOf(c), 'service:protect', { projectId })
      const result = await beginHttpIntegration(deps, { ...body, project, service: c.req.param('service') })
      return c.json(result, result.ready ? 200 : 202)
    },
  )
  app.get(
    '/environments/:project/services/:service/http-integration/:requestId',
    documentRoute({
      tag: 'Environments',
      operationId: 'getServiceHttpIntegration',
      permission: 'service:read',
      summary: 'Get the result of one HTTP integration',
      response: HttpIntegrationOperation,
      parameters: [
        projectParameter,
        serviceParameter,
        { name: 'requestId', in: 'path' as const, required: true, schema: { type: 'string' as const, format: 'uuid' } },
      ],
      errors: [400, 403, 404, 500, 502],
    }),
    async (c) => {
      const project = c.req.param('project')
      authorizeScope(c, await projectOfEnvironment(deps.db, project))
      return c.json(await httpIntegrationStatus(deps, project, c.req.param('service'), c.req.param('requestId')))
    },
  )
  return app
}
