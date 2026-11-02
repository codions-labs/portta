'use client'

// The section rail of Settings: what this person can open, and which they are on.

import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { LinkTabs } from '@/components/ui/tabs'
import { usePrincipal } from '@/lib/principal'
import { visibleSections } from './sections'

export function SettingsSections({ signsPeopleIn }: { signsPeopleIn: boolean }) {
  const { t } = useTranslation('settings')
  const pathname = usePathname()
  const sections = visibleSections({ permissions: usePrincipal().permissions, signsPeopleIn })
  const active = sections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))

  // One section is a page, not a choice between sections.
  if (sections.length < 2) return null

  return (
    <LinkTabs
      label={t('sectionsLabel')}
      active={active?.id ?? ''}
      tabs={sections.map((section) => ({ id: section.id, label: t(`sections.${section.id}`), href: section.href }))}
    />
  )
}
