import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SettingsSections } from '@/components/settings/settings-sections'
import { serverTranslation } from '@/lib/i18n/server'
import { panelSignsPeopleIn } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('settings')
  return { title: t('title') }
}

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsSections signsPeopleIn={panelSignsPeopleIn()} />
      {children}
    </>
  )
}
