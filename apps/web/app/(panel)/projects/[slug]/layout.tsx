import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { ProjectHeader } from '@/components/projects/project-header'
import { ProjectTabs } from '@/components/projects/project-tabs'
import { projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const project = await projectPage(slug)
  return { title: project?.name ?? slug }
}

/**
 * The frame every Project tab is rendered in: the header, the tabs, and the
 * check that this person may see the Project at all.
 *
 * A Project that does not exist and one this caller is not a member of are the
 * same 404, deliberately: answering differently would say which slugs exist to
 * somebody who may not see them.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectHeader project={project} />
      <ProjectTabs
        slug={project.slug}
        name={project.name}
        repositories={project.repositories.length}
        environments={project.environments.length}
      />
      <div role="tabpanel" tabIndex={0} className="flex min-h-0 flex-1 flex-col pt-4 outline-none">
        {children}
      </div>
    </div>
  )
}
