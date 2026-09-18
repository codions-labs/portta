import { pageNeeds } from '@/lib/server/page-data'
import { WorktreesPage } from '@/modules/taskflow/containers/worktrees-page'
import { routeParam } from '@/modules/taskflow/lib/navigation'

export const dynamic = 'force-dynamic'

export default async function ProjectWorktreePage({ params }: { params: Promise<{ name: string }> }) {
  await pageNeeds('worktree:read')
  const { name } = await params
  return <WorktreesPage name={routeParam(name)} />
}
