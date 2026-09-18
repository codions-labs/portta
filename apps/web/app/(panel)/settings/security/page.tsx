import type { Metadata } from 'next'
import { LocalMode } from '@/components/settings/local-mode'
import { serverTranslation } from '@/lib/i18n/server'
import { panelSignsPeopleIn } from '@/lib/server/page-data'
import { SecurityView } from './security-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('sections.security') }
}

/**
 * Your own account. No permission gates it: everybody who signed in has one,
 * and a viewer changes their own password like anybody else.
 */
export default async function SecuritySettingsPage() {
  if (!panelSignsPeopleIn()) return <LocalMode section="security" />
  return <SecurityView />
}
