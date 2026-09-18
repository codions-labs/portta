import { Hono } from 'hono'
import { log } from '../lib/log.ts'
import { ProjectAllowlistError } from '../services/project-allowlist.ts'
import type { HostProjects } from './host-projects.ts'
import { agentRoutes } from './routes/agents.ts'
import { branchRoutes } from './routes/branches.ts'
import { configRoutes } from './routes/config.ts'
import { environmentRoutes } from './routes/environments.ts'
import { githubRoutes } from './routes/github.ts'
import { linearRoutes } from './routes/linear.ts'
import { notificationRoutes } from './routes/notifications.ts'
import { projectSnapshotRoutes } from './routes/project.ts'
import { projectsRoutes } from './routes/projects.ts'
import { runRoutes } from './routes/runs.ts'
import { worktreeRoutes } from './routes/worktrees.ts'

export interface TaskflowHostDeps {
  projects: HostProjects
  /** Whether a request carries the host's Bearer token. The daemon checks every
   *  request before it reaches this app; agent hooks' runtime events are asked
   *  again, because that route is the one a process outside the panel calls. */
  hasValidToken(request: Request): Promise<boolean>
}

/** The module's HTTP surface: global routes, and every Project's routes under
 *  `/:prefix`. The host daemon mounts it at `/api/modules/taskflow`. */
export function createTaskflowHostApp(deps: TaskflowHostDeps): Hono {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof ProjectAllowlistError) return c.json({ error: error.message }, 403)
    log.error(`[api] ${c.req.method} ${c.req.path} failed: ${error instanceof Error ? error.message : String(error)}`)
    return c.json({ error: 'Internal error' }, 500)
  })

  app.route('/', projectsRoutes({ projects: deps.projects }))

  // Every Project answers under its own prefix; one router per route group.
  for (const routes of [
    configRoutes,
    environmentRoutes,
    branchRoutes,
    projectSnapshotRoutes,
    agentRoutes,
    worktreeRoutes,
    linearRoutes,
    githubRoutes,
    runRoutes,
    notificationRoutes,
  ]) {
    app.route('/:prefix', routes({ projects: deps.projects, hasValidToken: deps.hasValidToken }))
  }

  app.all('*', (c) => c.json({ error: `no such endpoint: ${c.req.path}` }, 404))

  return app
}
