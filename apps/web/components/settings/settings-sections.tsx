'use client'

// The section rail of Settings: what this person can open, and which they are on.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { usePrincipal } from '@/lib/principal'
import { cn } from '@/lib/utils'
import { moduleText } from '@/modules'
import { useModules } from '@/modules/registered'
import { type BaseSettingsSectionId, visibleSections } from './sections'

export function SettingsSections({ signsPeopleIn }: { signsPeopleIn: boolean }) {
  const { t } = useTranslation('settings')
  const pathname = usePathname()
  const sections = visibleSections({ permissions: usePrincipal().permissions, signsPeopleIn, modules: useModules() })

  return (
    <nav
      aria-label={t('sectionsLabel')}
      className="-mx-4 mb-4 flex gap-0.5 overflow-x-auto border-b border-line px-4 scroll-thin"
    >
      {sections.map((section) => {
        const selected = pathname === section.href || pathname.startsWith(`${section.href}/`)
        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'relative flex h-9 shrink-0 items-center px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-100 focus-ring-inset',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              selected ? 'text-ink after:bg-accent' : 'text-subtle after:bg-transparent hover:text-ink',
            )}
          >
            {section.labelKey ? moduleText(t, section.labelKey) : t(`sections.${section.id as BaseSettingsSectionId}`)}
          </Link>
        )
      })}
    </nav>
  )
}
