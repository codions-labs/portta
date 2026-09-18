import type { Metadata } from 'next'
import { LocalMode } from '@/components/settings/local-mode'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds, panelSignsPeopleIn } from '@/lib/server/page-data'
import { AuditView } from './audit-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('sections.audit') }
}

export default async function AuditSettingsPage() {
  if (!panelSignsPeopleIn()) return <LocalMode section="audit" />
  await pageNeeds('audit:read')
  return <AuditView />
}
