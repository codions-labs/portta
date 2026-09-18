import { pageNeeds } from '@/lib/server/page-data'
import { WorkflowPage } from '@/modules/taskflow/containers/workflows-page'
import { routeParam } from '@/modules/taskflow/lib/navigation'

export const dynamic = 'force-dynamic'

export default async function ProjectWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  await pageNeeds('workflow:read')
  const { id } = await params
  return <WorkflowPage id={routeParam(id)} />
}
