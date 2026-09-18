import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { DockerView } from './docker-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('docker')
  return { title: t('title') }
}

export default async function DockerPage() {
  await pageNeeds('docker:read')
  return <DockerView />
}
