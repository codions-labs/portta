import { notFound } from 'next/navigation'
import { IssueView } from '@/components/issues/issue-view'
import { panelIsReadOnly, projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

/**
 * One issue, addressed by its ref.
 *
 * The segment carries the whole `github:owner/repo#113`, url-encoded, because
 * the ref is the identity everywhere else in Portta — a session, an activity
 * event and an environment link all name the issue this way, so a link from
 * any of them is this address with no translation step.
 */
export default async function ProjectIssuePage({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  return <IssueView project={project} issueRef={decodeURIComponent(ref)} readOnly={panelIsReadOnly()} />
}
