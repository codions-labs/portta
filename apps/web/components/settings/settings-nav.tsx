'use client'

import Link from 'next/link'
import { slug } from 'portta-core/browser'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'
import { Badge } from '../ui/badge.tsx'

export function SettingsNav({
  groups,
  active,
  dirtyCounts,
  base = '/settings/general',
}: {
  groups: string[]
  active: string | null
  dirtyCounts: ReadonlyMap<string, number>
  /** What a group's slug hangs off. One place, so a moved section is one edit. */
  base?: string
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  return (
    <nav
      aria-label={t('navLabel', { defaultValue: 'Settings groups' })}
      className="-mx-4 flex gap-0.5 overflow-x-auto px-4 pb-2 md:sticky md:top-0 md:mx-0 md:w-44 md:shrink-0 md:flex-col md:overflow-visible md:px-0 md:pb-0 scroll-thin"
    >
      {groups.map((group) => {
        const groupSlug = slug(group)
        const selected = group === active
        const dirty = dirtyCounts.get(group) ?? 0
        const label = t(`groups.${group}`, { defaultValue: group })
        return (
          <Link
            key={group}
            href={`${base}/${groupSlug}`}
            aria-label={dirty > 0 ? `${label}, ${tc('unsaved', { count: dirty })}` : undefined}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex h-7 items-center justify-between gap-2 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors duration-100 focus-ring',
              selected ? 'bg-fill-strong text-ink' : 'text-muted hover:bg-fill hover:text-ink',
            )}
          >
            <span>{label}</span>
            {dirty > 0 ? <Badge tone="warn">{dirty}</Badge> : null}
          </Link>
        )
      })}
    </nav>
  )
}
