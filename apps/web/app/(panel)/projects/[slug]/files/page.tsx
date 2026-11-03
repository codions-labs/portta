import { notFound } from 'next/navigation'
import { ProjectFilesTab } from '@/components/projects/project-files'
import { projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectFilesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  return <ProjectFilesTab slug={project.slug} />
}
