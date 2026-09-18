import { pageNeeds } from '@/lib/server/page-data'
import { RunsPage } from '@/modules/taskflow/containers/runs-page'

export const dynamic = 'force-dynamic'

export default async function ProjectRunsPage() {
  await pageNeeds('run:read')
  return <RunsPage />
}
