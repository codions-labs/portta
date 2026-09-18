import { notFound } from 'next/navigation'
import { panelIsReadOnly, projectPage } from '@/lib/server/page-data'
import { IssuesTabView } from './issues-tab-view.tsx'

export const dynamic = 'force-dynamic'

/**
 * The Project is read here, the issues are not.
 *
 * Every other tab hands its rows to the client already read, because they come
 * from this panel's own database. Issues come from GitHub or Linear through
 * the host daemon, and a provider that is slow or unreachable would hold the
 * whole page — header, tabs and all — rather than one panel inside it.
 */
export default async function ProjectIssuesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  return <IssuesTabView project={project} readOnly={panelIsReadOnly()} />
}
