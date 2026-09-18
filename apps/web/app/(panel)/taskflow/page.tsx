import type { Metadata } from 'next'
import { readProjectDirectories } from 'portta-server'
import { serverDeps } from '@/lib/server/deps'
import { pageNeedsModule } from '@/lib/server/modules'
import { pageNeeds, pagePrincipal } from '@/lib/server/page-data'
import { TaskflowHomePage } from '@/modules/taskflow/containers/home-page'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Taskflow' }

export default async function TaskflowPage() {
  pageNeedsModule('taskflow')
  await pageNeeds('worktree:read')
  // The directories of the Projects this person sees, so each Taskflow entry can name its Project.
  const projects = await readProjectDirectories(serverDeps(), await pagePrincipal())
  return <TaskflowHomePage projects={projects} />
}
