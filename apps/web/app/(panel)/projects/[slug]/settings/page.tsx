import { notFound } from 'next/navigation'
import { SettingsTab } from '@/components/projects/settings-tab'
import { panelIsReadOnly, projectPage } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export default async function ProjectSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await projectPage(slug)
  if (!project) notFound()
  return <SettingsTab project={project} readOnly={panelIsReadOnly()} />
}
