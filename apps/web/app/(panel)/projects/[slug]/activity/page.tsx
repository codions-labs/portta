import { notFound } from 'next/navigation'
import { ActivityTab } from '@/components/projects/activity-tab'
import { activityPage, projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  const events = await activityPage({ projectId: project.id, limit: 50 })
  return <ActivityTab slug={project.slug} initialEvents={events} />
}
