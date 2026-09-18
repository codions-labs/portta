import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { ServicesView } from './services-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('services')
  return { title: t('title') }
}

export default async function ServicesPage() {
  await pageNeeds('service:read')
  return <ServicesView />
}
