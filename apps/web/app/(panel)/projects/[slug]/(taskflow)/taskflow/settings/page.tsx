import { pageNeeds } from '@/lib/server/page-data'
import { SettingsPage } from '@/modules/taskflow/containers/settings-page'

export const dynamic = 'force-dynamic'

export default async function ProjectTaskflowSettingsPage() {
  await pageNeeds('agent:read')
  return <SettingsPage />
}
