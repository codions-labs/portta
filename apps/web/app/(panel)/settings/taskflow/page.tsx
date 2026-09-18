import type { Metadata } from 'next'
import { pageNeedsModule } from '@/lib/server/modules'
import { pageNeeds } from '@/lib/server/page-data'
import { TaskflowPreferencesPage } from '@/modules/taskflow/containers/preferences-page'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Taskflow' }

export default async function TaskflowSettingsPage() {
  pageNeedsModule('taskflow')
  await pageNeeds('worktree:read')
  return <TaskflowPreferencesPage />
}
