import { notFound } from 'next/navigation'
import { RepositoriesTab } from '@/components/projects/repositories-tab'
import { panelIsReadOnly, projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectRepositoriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  return <RepositoriesTab project={project} readOnly={panelIsReadOnly()} />
}
