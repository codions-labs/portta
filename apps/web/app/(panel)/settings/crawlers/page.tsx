import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { CrawlersView } from './crawlers-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('crawlers.title') }
}

export default async function CrawlersSettingsPage() {
  await pageNeeds('settings:read')
  return <CrawlersView />
}
