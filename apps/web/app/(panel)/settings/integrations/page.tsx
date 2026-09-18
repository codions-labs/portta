import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { IntegrationsView } from './integrations-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('sections.integrations') }
}

export default async function IntegrationsSettingsPage() {
  await pageNeeds('issue:read')
  return <IntegrationsView />
}
