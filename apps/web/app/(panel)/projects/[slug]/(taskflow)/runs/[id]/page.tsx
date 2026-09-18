import { pageNeeds } from '@/lib/server/page-data'
import { RunPage } from '@/modules/taskflow/containers/runs-page'
import { routeParam } from '@/modules/taskflow/lib/navigation'

export const dynamic = 'force-dynamic'

export default async function ProjectRunPage({ params }: { params: Promise<{ id: string }> }) {
  await pageNeeds('run:read')
  const { id } = await params
  return <RunPage id={routeParam(id)} />
}
