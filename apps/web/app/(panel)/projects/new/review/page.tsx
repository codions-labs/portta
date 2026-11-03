import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { ReviewView } from './review-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('projects')
  return { title: t('review.title') }
}

export default async function ReviewFolderPage({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  await pageNeeds('project:create')
  const { path } = await searchParams
  return <ReviewView path={path ?? ''} />
}
