import { notFound } from 'next/navigation'
import { EnvironmentsTab } from '@/components/projects/environments-tab'
import { panelIsReadOnly, projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectEnvironmentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  return <EnvironmentsTab project={project} readOnly={panelIsReadOnly()} />
}
