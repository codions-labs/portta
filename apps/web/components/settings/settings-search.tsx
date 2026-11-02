'use client'

// Finding a setting by what it does, without knowing which section keeps it.

import { Search } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrincipal } from '@/lib/principal'
import { useConfig } from '@/lib/queries'
import { hostGroupItems, visibleSections } from './sections'
import { ALWAYS_HIDDEN } from './visibility'

const SHOWN = 8

/** So "certificacao" finds "certificação". */
function folded(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function SettingsSearch({ signsPeopleIn }: { signsPeopleIn: boolean }) {
  const { t } = useTranslation('settings')
  const { permissions } = usePrincipal()
  const mayRead = permissions.includes('settings:read')
  const config = useConfig(mayRead)
  const [query, setQuery] = useState('')

  const entries = useMemo(() => {
    const view = config.data
    const items = mayRead ? hostGroupItems(view?.groups) : []
    const sectionLabel = (id: string, fallback: string) =>
      t(`rail.items.${id}` as never, { defaultValue: fallback }) as string
    // The sections themselves come first: looking for "users" means the page.
    const sections = [
      ...items.map((item) => {
        const label = sectionLabel(item.id, item.groups[0] ?? item.id)
        return {
          key: item.id,
          label,
          section: t('rail.host'),
          href: item.href,
          text: folded(`${label} ${item.groups.join(' ')}`),
        }
      }),
      ...visibleSections({ permissions, signsPeopleIn })
        .filter((section) => section.id !== 'general')
        .map((section) => {
          const label = t(`sections.${section.id}`)
          return { key: section.id, label, section: t('rail.people'), href: section.href, text: folded(label) }
        }),
    ]
    if (!view) return sections
    const fields = view.fields.flatMap((field) => {
      if (ALWAYS_HIDDEN.has(field.key)) return []
      const item = items.find((candidate) => candidate.groups.includes(field.group))
      if (!item) return []
      const label = t(`fields.${field.key}.label` as never, { defaultValue: field.label }) as string
      const help = t(`fields.${field.key}.help` as never, { defaultValue: field.help }) as string
      const section = t(`rail.items.${item.id}` as never, { defaultValue: field.group }) as string
      return [
        {
          key: field.key,
          label,
          section,
          href: `${item.href}?field=${encodeURIComponent(field.key)}`,
          // A field is found by its name, what it does, its variable and its section.
          text: folded([label, help, field.key, section, field.group].join(' ')),
        },
      ]
    })
    return [...sections, ...fields]
  }, [config.data, mayRead, permissions, signsPeopleIn, t])

  // Nobody needs a search over one or two lines.
  if (entries.length < 3) return null

  const needle = folded(query.trim())
  const found = needle === '' ? [] : entries.filter((entry) => entry.text.includes(needle))

  return (
    <div className="relative w-64 max-w-full md:w-75">
      <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-subtle focus-within:border-accent">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.aria')}
          className="w-full min-w-0 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
        />
      </label>
      {needle !== '' ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-overlay">
          {found.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-subtle">{t('search.empty')}</p>
          ) : (
            <ul>
              {found.slice(0, SHOWN).map((entry) => (
                <li key={entry.key} className="border-t border-line first:border-t-0">
                  <Link
                    href={entry.href}
                    onClick={() => setQuery('')}
                    className="block px-3.5 py-2 hover:bg-fill focus-ring"
                  >
                    <span className="block truncate text-sm font-medium text-ink">{entry.label}</span>
                    <span className="block truncate text-xs text-subtle">{entry.section}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
