// Taskflow's half in the panel: the authorised way to the host daemon.
//
// Taskflow's routes run in `portta host serve`, where git, tmux and the agents
// are (ADR 0047). This module forwards the browser's requests and sockets to
// it, one to one, after deciding with Portta's permissions and Project scopes
// whether the caller may make them. It adds no state of its own.

import type { Diagnostic } from 'portta-contracts'
import { taskflowModule } from 'portta-core/modules'
import { registerTaskflowTools } from 'portta-mcp'
import type { PanelConfig } from '../../config.ts'
import type { AppDeps } from '../../deps.ts'
import type { ServerModule } from '../index.ts'
import { createHostProxy, createHostWsRoute, type RoutePermissionTable, readHostToken } from '../proxy.ts'
import { TASKFLOW_ROUTES, TASKFLOW_WS_ROUTES } from './routes.ts'
import { createTaskflowScopes, fetchTaskflowProjects, type TaskflowScopes } from './scope.ts'

export { type ProjectDirectories, projectHostPaths, readProjectDirectories } from './scope.ts'

const ID = taskflowModule.id

/** The forwarding table, each Project-scoped route resolving its Project from the prefix. */
export function taskflowRouteTable(scopes: TaskflowScopes): RoutePermissionTable {
  return TASKFLOW_ROUTES.map((route) => ({
    method: route.method,
    pattern: route.pattern,
    permission: route.permission,
    ...(route.scoped ? { scopeOf: (params: Record<string, string>) => scopes.scopeOf(params.prefix) } : {}),
  }))
}

/**
 * Whether the daemon answers Taskflow with the token this panel holds.
 *
 * One authenticated read of the registry proves all three things that must be
 * true — configured, reachable, and the same token — and says how many Projects
 * it serves when they are.
 */
export async function taskflowDiagnostics(
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>,
  request: typeof fetch = fetch,
): Promise<Diagnostic[]> {
  const check = (
    status: Diagnostic['status'],
    detail: string,
    fix = '',
    params?: Record<string, string | number>,
  ): Diagnostic[] => [
    {
      id: 'taskflow-host',
      status,
      title: 'Taskflow host daemon',
      detail,
      fix,
      category: 'development',
      ...(params ? { params } : {}),
    },
  ]
  if (!config.hostUrl) {
    return check(
      'fail',
      'PORTTA_HOST_URL is not set, so the panel cannot reach the host daemon',
      'Apply the panel overlays with portta up; they hand the panel PORTTA_HOST_URL and the daemon token',
    )
  }
  const token = readHostToken(config.hostTokenFile)
  if (!token) {
    return check(
      'fail',
      `the daemon token is not readable at ${config.hostTokenFile}`,
      'Start the daemon on the host with portta host serve; it writes the token the panel mounts',
      { file: config.hostTokenFile },
    )
  }
  let response: Response
  try {
    response = await request(`${config.hostUrl.replace(/\/+$/, '')}/api/modules/taskflow/api/projects`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    return check(
      'fail',
      `nothing answers at ${config.hostUrl}`,
      'Start the daemon on the host with portta host serve, and check its bind address with portta doctor',
      { url: config.hostUrl },
    )
  }
  if (response.status === 401) {
    return check(
      'fail',
      'the daemon refused the token the panel holds',
      'Restart the panel after the daemon rotated its token',
    )
  }
  if (!response.ok) {
    return check(
      'warn',
      `the daemon answered ${response.status} for Taskflow`,
      'Update portta on the host so its daemon serves the Taskflow module',
      { status: response.status },
    )
  }
  const body = (await response.json().catch(() => ({}))) as { projects?: unknown[] }
  const count = Array.isArray(body.projects) ? body.projects.length : 0
  return check('pass', `reachable at ${config.hostUrl}, serving ${count} project(s)`, '', {
    url: config.hostUrl,
    count,
  })
}

function scopesFor(deps: AppDeps): TaskflowScopes {
  return createTaskflowScopes({ deps, projects: () => fetchTaskflowProjects(deps.config) })
}

export const taskflowServerModule = {
  manifest: taskflowModule,
  routes: (deps: AppDeps) =>
    createHostProxy({ moduleId: ID, routes: taskflowRouteTable(scopesFor(deps)), config: deps.config }),
  ws: (deps: AppDeps) => {
    const scopes = scopesFor(deps)
    return TASKFLOW_WS_ROUTES.map((route) =>
      createHostWsRoute({
        moduleId: ID,
        path: route.path,
        permission: route.permission,
        scopeOf: (params) => scopes.scopeOf(params.prefix),
        config: deps.config,
      }),
    )
  },
  tags: [
    {
      name: 'Taskflow',
      description:
        'Worktrees, terminals, agent chat and Runs on the host, forwarded to the host daemon under /api/modules/taskflow. Each route and its schemas are in taskflow.openapi.json.',
    },
  ],
  // The same sixteen tools `portta mcp` serves, on the panel's transport.
  mcp: registerTaskflowTools,
  doctor: (deps: AppDeps) => taskflowDiagnostics(deps.config),
} as const satisfies ServerModule
