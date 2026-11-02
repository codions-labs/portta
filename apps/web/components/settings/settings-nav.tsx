'use client'

// The sections of Settings, split by what they are about: this host, or people.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { usePrincipal } from '@/lib/principal'
import { useConfig } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { hostGroupItems, visibleSections } from './sections'
import { useDirtyCounts } from './settings-shell'

function Item({
  href,
  label,
  active,
  count,
  unsaved,
}: {
  href: string
  label: string
  active: boolean
  count?: number
  unsaved?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={count ? `${label}, ${unsaved}` : undefined}
      className={cn(
        'flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-100 focus-ring',
        active ? 'bg-accent text-accent-fg shadow-raised' : 'text-muted hover:bg-fill hover:text-ink',
      )}
    >
      {label}
      {count ? (
        <span
          className={cn(
            'ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-semibold',
            active ? 'bg-accent-fg text-accent' : 'bg-warn-wash text-warn',
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}

export function SettingsNav({ signsPeopleIn }: { signsPeopleIn: boolean }) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const pathname = usePathname()
  const sections = visibleSections({ permissions: usePrincipal().permissions, signsPeopleIn })
  const opensHost = sections.some((section) => section.id === 'general')
  const people = sections.filter((section) => section.id !== 'general')
  const config = useConfig(opensHost)
  const dirty = useDirtyCounts()

  const items = opensHost ? hostGroupItems(config.data?.groups) : []
  const here = pathname.split('/')[3]
  // One section is a page, not a choice between sections.
  if (items.length + people.length < 2) return null

  const label = 'mb-1.5 hidden px-3 text-2xs font-semibold tracking-[0.14em] text-subtle uppercase md:block'

  return (
    <nav
      aria-label={t('sectionsLabel')}
      className="-mx-4 flex gap-0.5 overflow-x-auto px-4 pb-1 md:sticky md:top-0 md:mx-0 md:w-52 md:shrink-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
    >
      {items.length > 0 ? (
        <>
          <p className={label}>{t('rail.host')}</p>
          {items.map((item, index) => {
            const count = item.groups.reduce((sum, group) => sum + (dirty.get(group) ?? 0), 0)
            return (
              <Item
                key={item.id}
                href={item.href}
                label={t(`rail.items.${item.id}` as never, { defaultValue: item.groups[0] }) as string}
                active={
                  pathname.startsWith('/settings/general') &&
                  (item.slugs.includes(here ?? '') || (here === undefined && index === 0))
                }
                count={count}
                unsaved={tc('unsaved', { count })}
              />
            )
          })}
        </>
      ) : null}
      {people.length > 0 ? (
        <>
          <p className={cn(label, items.length > 0 && 'mt-3.5')}>{t('rail.people')}</p>
          {people.map((section) => (
            <Item
              key={section.id}
              href={section.href}
              label={t(`sections.${section.id}`)}
              active={pathname === section.href || pathname.startsWith(`${section.href}/`)}
            />
          ))}
        </>
      ) : null}
    </nav>
  )
}
