import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { AccessView } from './access-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('access')
  return { title: t('title') }
}

export default async function AccessPage() {
  await pageNeeds('access:read')
  return <AccessView />
}
