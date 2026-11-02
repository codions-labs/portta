import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { developmentOverview, readProjects } from 'portta-server'
import { serverTranslation } from '@/lib/i18n/server'
import { serverDeps } from '@/lib/server/deps'
import { pageNeeds, panelIsReadOnly } from '@/lib/server/page-data'
import { requirePrincipal } from '@/lib/server/principal'
import { EnvironmentsView } from '../environments/environments-view'
import { ProjectsView } from './projects-view'
import { ServicesView } from './services-view'

// A catalogue of what is running on a host, read on every request.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('projects')
  return { title: t('title') }
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; new?: string }>
}) {
  const { view, new: create } = await searchParams
  if (view === 'services') {
    await pageNeeds('service:read')
    return <ServicesView />
  }
  if (view === 'environments') {
    await pageNeeds('environment:read')
    return <EnvironmentsView readOnly={panelIsReadOnly()} />
  }

  const deps = serverDeps()
  const principal = await requirePrincipal()
  if (!principal) redirect('/sign-in')

  // Read here, not fetched: the request would leave the process and come back
  // through the same dispatcher to reach code this render already has.
  const [projects, overview] = await Promise.all([readProjects(deps, principal), developmentOverview(deps, principal)])
  return <ProjectsView initialProjects={projects} initialOverview={overview} startCreating={create === '1'} />
}
