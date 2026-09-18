import type { Metadata } from 'next'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds } from '@/lib/server/page-data'
import { GeneralView } from './general-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('sections.general') }
}

/**
 * The gateway's `.env`, one group at a time.
 *
 * The group is a path segment rather than a query so a bookmark is a group, and
 * an optional one so `/settings/general` lands on the first.
 */
export default async function GeneralSettingsPage({ params }: { params: Promise<{ group?: string[] }> }) {
  await pageNeeds('settings:read')
  const { group } = await params
  return <GeneralView group={group?.[0] ?? null} />
}
