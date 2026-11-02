import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { AddProjectView } from './add-project-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('projects')
  return { title: t('add.title') }
}

export default async function AddProjectPage() {
  await pageNeeds('project:create')
  return <AddProjectView />
}
