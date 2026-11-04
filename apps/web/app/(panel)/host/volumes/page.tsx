import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { VolumesView } from './volumes-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('cleanup')
  return { title: t('volumes.title') }
}

export default async function VolumesPage() {
  await pageNeeds('docker:read')
  return <VolumesView />
}
