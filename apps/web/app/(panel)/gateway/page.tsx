import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { GatewayView } from './gateway-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('gateway')
  return { title: t('title') }
}

export default async function GatewayPage() {
  await pageNeeds('gateway:read')
  return <GatewayView />
}
