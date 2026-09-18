import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds, panelIsReadOnly } from '@/lib/server/page-data'
import { EnvironmentsView } from './environments-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('environments')
  return { title: t('list.title') }
}

export default async function EnvironmentsPage() {
  await pageNeeds('environment:read')
  return <EnvironmentsView readOnly={panelIsReadOnly()} />
}
