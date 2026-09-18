import type { Hono } from 'hono'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import type { ContractKey } from '../openapi.ts'
import type { EnvironmentAction } from '../project-environments.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter } from './project-router.ts'

const ACTIONS = [
  ['trustEnvironment', 'trust'],
  ['startEnvironment', 'start'],
  ['stopEnvironment', 'stop'],
  ['restartEnvironment', 'restart'],
  ['rebuildEnvironment', 'rebuild'],
] as const satisfies ReadonlyArray<readonly [ContractKey, EnvironmentAction]>

export function environmentRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchEnvironment', 'Environments', ({ environments }, { params }) => {
    const record = environments.environmentForProject(params.environmentId)
    return record
      ? jsonResponse({ environment: environments.publicEnvironment(record) })
      : errorResponse('Environment not found', 404)
  })

  projectRoute(app, deps, 'removeEnvironment', 'Environments', async ({ environments }, { params }) => {
    const record = environments.environmentForProject(params.environmentId)
    if (!record) return errorResponse('Environment not found', 404)
    await environments.destroyEnvironmentRecord(record)
    return jsonResponse({ ok: true })
  })

  projectRoute(app, deps, 'fetchEnvironmentServices', 'Environments', async ({ environments }, { params }) => {
    const record = environments.environmentForProject(params.environmentId)
    return record
      ? jsonResponse({ services: await environments.environmentServices(record) })
      : errorResponse('Environment not found', 404)
  })

  for (const [key, action] of ACTIONS) {
    projectRoute(app, deps, key, 'Environments', async ({ environments }, { params }) => {
      const result = await environments.applyEnvironmentAction(params.environmentId, action)
      return result.ok ? jsonResponse({ environment: result.environment }) : errorResponse(result.error, result.status)
    })
  }

  projectRoute(app, deps, 'execEnvironment', 'Environments', async ({ environments }, { params, body }) => {
    const record = environments.environmentForProject(params.environmentId)
    if (!record) return errorResponse('Environment not found', 404)
    if (record.status !== 'ready') return errorResponse('Environment is not ready', 409)
    const transport = environments.environmentTransport(record)
    if (!transport) return errorResponse(`Environment transport is unavailable: ${record.provider}`, 409)
    const command = transport.spawn(record, {
      argv: body.argv,
      ...(body.cwd ? { cwd: { containerPath: body.cwd } } : { cwd: 'workspace' as const }),
      env: body.env,
      timeoutMs: body.timeoutMs,
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(command.stdout).text(),
      new Response(command.stderr).text(),
      command.exited,
    ])
    return jsonResponse({ stdout, stderr, ...exit })
  })

  projectRoute(app, deps, 'openEnvironmentTerminal', 'Environments', ({ environments }, { params }) => {
    const record = environments.environmentForProject(params.environmentId)
    if (!record) return errorResponse('Environment not found', 404)
    if (record.status !== 'ready') return errorResponse('Environment is not ready', 409)
    const transport = environments.environmentTransport(record)
    return transport
      ? jsonResponse(transport.terminalInvocation(record))
      : errorResponse(`Environment transport is unavailable: ${record.provider}`, 409)
  })

  projectRoute(app, deps, 'fetchEnvironmentLogs', 'Environments', ({ environments }, { params }) => {
    const record = environments.environmentForProject(params.environmentId)
    if (!record) return errorResponse('Environment not found', 404)
    if (record.status !== 'ready') return errorResponse('Environment is not ready', 409)
    const transport = environments.environmentTransport(record)
    return transport
      ? jsonResponse(transport.logsInvocation(record))
      : errorResponse(`Environment transport is unavailable: ${record.provider}`, 409)
  })

  projectRoute(app, deps, 'exposeEnvironmentService', 'Environments', async ({ environments }, { params }) => {
    const record = environments.environmentForProject(params.environmentId)
    if (!record) return errorResponse('Environment not found', 404)
    const services = await environments.environmentServices(record)
    const service = services.find((candidate) => candidate.id === params.serviceId)
    if (!service) return errorResponse('Environment service not found', 404)
    const endpoint = await environments.publishEnvironmentService(record, service)
    service.endpoints = service.endpoints
      .filter((candidate) => !environments.isLocalEnvironmentEndpoint(candidate))
      .concat(endpoint)
    environments.store.replaceServices(record.id, services)
    return jsonResponse({ services })
  })

  projectRoute(app, deps, 'controlEnvironmentService', 'Environments', async ({ environments }, { params, body }) => {
    const record = environments.environmentForProject(params.environmentId)
    if (!record) return errorResponse('Environment not found', 404)
    const services = await environments.environmentServices(record)
    const service = services.find((candidate) => candidate.id === params.serviceId)
    if (!service) return errorResponse('Environment service not found', 404)
    await environments.controlEnvironmentService(record, service, body.action)
    return jsonResponse({ services: await environments.environmentServices(record) })
  })

  projectRoute(app, deps, 'removeEndpoint', 'Endpoints', async ({ environments }, { params }) => {
    for (const environment of environments.projectEnvironments()) {
      const services = environments.store.listServices(environment.id)
      for (const service of services) {
        const endpoint = service.endpoints.find((candidate) => candidate.id === params.endpointId)
        if (!endpoint) continue
        await environments.revokeLocalEndpoint(endpoint)
        service.endpoints = service.endpoints.filter((candidate) => candidate.id !== endpoint.id)
        environments.store.replaceServices(environment.id, services)
        return jsonResponse({ ok: true })
      }
    }
    return errorResponse('Environment endpoint not found', 404)
  })

  return app
}
