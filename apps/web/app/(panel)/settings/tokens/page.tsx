import type { Metadata } from 'next'
import { LocalMode } from '@/components/settings/local-mode'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds, panelSignsPeopleIn } from '@/lib/server/page-data'
import { TokensView } from './tokens-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('sections.tokens') }
}

export default async function TokensSettingsPage() {
  if (!panelSignsPeopleIn()) return <LocalMode section="tokens" />
  await pageNeeds('token:read')
  return <TokensView />
}
