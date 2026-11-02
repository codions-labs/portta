import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { SitesView } from './sites-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('access')
  return { title: t('title') }
}

export default function AccessPage() {
  return <SitesView />
}
