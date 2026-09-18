import type { Metadata } from 'next'
import { LocalMode } from '@/components/settings/local-mode'
import { serverTranslation } from '@/lib/i18n/server'
import { pageNeeds, panelSignsPeopleIn } from '@/lib/server/page-data'
import { UsersView } from './users-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('sections.users') }
}

export default async function UsersSettingsPage() {
  // The mode question comes first: in `open` mode the local operator holds
  // `user:list` and there is still nobody to list.
  if (!panelSignsPeopleIn()) return <LocalMode section="users" />
  await pageNeeds('user:list')
  return <UsersView />
}
