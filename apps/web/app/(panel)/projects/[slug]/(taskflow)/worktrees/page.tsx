import { pageNeeds } from '@/lib/server/page-data'
import { WorktreesPage } from '@/modules/taskflow/containers/worktrees-page'

export const dynamic = 'force-dynamic'

export default async function ProjectWorktreesPage() {
  await pageNeeds('worktree:read')
  return <WorktreesPage name={null} />
}
