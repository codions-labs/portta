import { pageNeeds } from '@/lib/server/page-data'
import { WorkflowsPage } from '@/modules/taskflow/containers/workflows-page'

export const dynamic = 'force-dynamic'

export default async function ProjectWorkflowsPage() {
  await pageNeeds('workflow:read')
  return <WorkflowsPage />
}
