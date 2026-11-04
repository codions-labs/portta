import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { MaintenanceView } from './maintenance-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('cleanup')
  return { title: t('maintenance.title') }
}

export default async function MaintenancePage() {
  await pageNeeds('docker:destroy')
  return <MaintenanceView />
}
