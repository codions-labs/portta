import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RepositoryPageView } from '@/components/entities/repository-page-view'
import { projectPage, repositoryPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const repository = await repositoryPage(id)
  return { title: repository?.name ?? id }
}

export default async function RepositoryPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const [project, repository] = await Promise.all([projectPage(slug), repositoryPage(id)])
  if (!project || !repository || repository.projectId !== project.id) notFound()

  return (
    <RepositoryPageView
      slug={project.slug}
      projectId={project.id}
      projectName={project.name}
      initialRepository={repository}
      tab={null}
    />
  )
}
