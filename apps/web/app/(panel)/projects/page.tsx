import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { developmentOverview, readProjects } from 'portta-server'
import { serverTranslation } from '@/lib/i18n/server'
import { serverDeps } from '@/lib/server/deps'
import { requirePrincipal } from '@/lib/server/principal'
import { ProjectsView } from './projects-view'

// A catalogue of what is running on a host, read on every request.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('projects')
  return { title: t('title') }
}

export default async function ProjectsPage() {
  const deps = serverDeps()
  const principal = await requirePrincipal()
  if (!principal) redirect('/sign-in')

  // Read here, not fetched: the request would leave the process and come back
  // through the same dispatcher to reach code this render already has.
  const [projects, overview] = await Promise.all([readProjects(deps, principal), developmentOverview(deps, principal)])
  return <ProjectsView initialProjects={projects} initialOverview={overview} />
}
