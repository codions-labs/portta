import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { AccessView } from '../access-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('access')
  return { title: t('tcp.tab') }
}

export default function AccessTcpPage() {
  return <AccessView />
}
