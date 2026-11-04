import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { ImagesView } from './images-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('cleanup')
  return { title: t('images.title') }
}

export default async function ImagesPage() {
  await pageNeeds('docker:read')
  return <ImagesView />
}
