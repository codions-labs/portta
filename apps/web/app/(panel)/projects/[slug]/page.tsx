import { notFound } from 'next/navigation'
import { ProjectOverview } from '@/components/projects/project-overview'
import { panelIsReadOnly, projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()

  return <ProjectOverview project={project} readOnly={panelIsReadOnly()} />
}
