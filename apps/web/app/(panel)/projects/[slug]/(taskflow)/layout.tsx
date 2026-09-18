import { notFound } from 'next/navigation'
import { projectHostPaths } from 'portta-server'
import type { ReactNode } from 'react'
import { pageNeedsModule } from '@/lib/server/modules'
import { pagePrincipal, projectPage } from '@/lib/server/page-data'
import { TaskflowProjectGate } from '@/modules/taskflow/components/workspace/project-gate'
import '@/modules/taskflow/styles.css'

export const dynamic = 'force-dynamic'

/** What any Taskflow tab of a Project needs to show at all. Each page asks for its own on top. */
const TASKFLOW_READ = ['worktree:read', 'run:read', 'workflow:read']

/**
 * The Taskflow tabs of a Project: Worktrees, Runs, Workflows and the module's
 * settings share one frame, so the notification stream and the worktree actions
 * outlive a switch between them.
 *
 * Only while the module is on, and only for somebody who may read one of them.
 * The directories are resolved here, where the repositories are, and the gate
 * finds the Taskflow Project they are in the browser, where the daemon is.
 */
export default async function TaskflowProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  pageNeedsModule('taskflow')
  const principal = await pagePrincipal()
  if (!TASKFLOW_READ.some((permission) => principal.permissions.has(permission as never))) notFound()
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()

  return (
    <TaskflowProjectGate
      slug={project.slug}
      projectId={project.id}
      hostPaths={projectHostPaths(project.resolvedPath, project.repositories)}
    >
      {children}
    </TaskflowProjectGate>
  )
}
