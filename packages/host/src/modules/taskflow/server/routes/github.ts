import { resolve } from 'node:path'
import type { Hono } from 'hono'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { log } from '../../lib/log.ts'
import { forcePullMainBranch, pullMainBranch } from '../../services/auto-pull-service.ts'
import { syncPrStatus } from '../../services/pr-service.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter, worktreeName } from './project-router.ts'

export function githubRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'setAutoRemoveOnMerge', 'GitHub', async (project, { body }) =>
    jsonResponse({ ok: true, enabled: await project.setAutoRemoveOnMergeEnabled(body.enabled) }),
  )

  projectRoute(app, deps, 'pullMain', 'GitHub', ({ runtime: { config, git, projectDir } }, { body }) => {
    const force = body.force === true
    const repo = body.repo ?? ''

    let projectRoot = projectDir
    if (repo) {
      const linkedRepo = config.integrations.github.linkedRepos.find((lr) => lr.alias === repo)
      if (!linkedRepo) return errorResponse(`Unknown linked repo: ${repo}`, 404)
      if (!linkedRepo.dir) return errorResponse(`Linked repo "${repo}" has no dir configured`, 400)
      const resolvedDir = resolve(projectDir, linkedRepo.dir)
      const repoRoot = git.resolveRepoRoot(resolvedDir)
      if (!repoRoot) return errorResponse(`Linked repo "${repo}" dir is not a git repository: ${resolvedDir}`, 400)
      projectRoot = repoRoot
    }

    // NOTE: linked repos inherit the project's mainBranch setting — if a linked
    // repo uses a different default branch this will need a per-repo override.
    const pullDeps = { git, projectRoot, mainBranch: config.workspace.mainBranch }
    const result = force ? forcePullMainBranch(pullDeps) : pullMainBranch(pullDeps)

    log.info(`[pull-main] ${repo || 'main'} ${force ? 'force ' : ''}pull: ${result.status}`)
    return jsonResponse(result)
  })

  projectRoute(app, deps, 'fetchCiLogs', 'GitHub', async ({ processRunner }, { params }) => {
    const proc = processRunner.start({ command: 'gh', args: ['run', 'view', String(params.runId), '--log-failed'] })
    const [exit, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    if (exit.code === 0) return jsonResponse({ logs: stdout })
    return errorResponse(`Failed to fetch logs: ${stderr.trim() || 'unknown error'}`, 502)
  })

  projectRoute(app, deps, 'syncWorktreePrs', 'GitHub', async (project, { params }) => {
    const name = worktreeName(params.name)
    if (name instanceof Response) return name
    const { config, projectDir } = project.runtime
    await syncPrStatus(project.getWorktreeGitDirs, config.integrations.github.linkedRepos, projectDir)
    const snapshot = await project.readProjectSnapshot()
    const worktree = snapshot.worktrees.find((w) => w.branch === name)
    if (!worktree) return errorResponse(`Worktree not found: ${name}`, 404)
    return jsonResponse(worktree)
  })

  return app
}
