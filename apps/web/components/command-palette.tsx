'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  Boxes,
  Container,
  Globe,
  Languages,
  LayoutDashboard,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  PlugZap,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Locale, useLocale } from '../lib/i18n/use-locale.ts'
import { navigate } from '../lib/navigation.ts'
import { useProjects } from '../lib/queries/index.ts'
import { type Theme, useThemeChoice } from '../lib/theme.ts'
import { cn } from '../lib/utils.ts'
import { Scrim } from './ui/dialog.tsx'
import { Kbd, useModKey } from './ui/kbd.tsx'
import { overlayItem, overlayLabel, overlaySurface } from './ui/surfaces.ts'

type Group = 'navigate' | 'projects' | 'actions' | 'preferences'

interface Command {
  id: string
  group: Group
  label: string
  /** Extra words the search should match: a slug, a synonym. */
  keywords?: string
  hint?: string
  icon: ComponentType<{ className?: string }>
  shortcut?: readonly string[]
  run: () => void
}

const SECTIONS: {
  path: string
  key: 'overview' | 'projects' | 'services' | 'docker' | 'network' | 'access' | 'gateway' | 'settings'
  icon: ComponentType<{ className?: string }>
}[] = [
  { path: '/overview', key: 'overview', icon: LayoutDashboard },
  { path: '/projects', key: 'projects', icon: Boxes },
  { path: '/services', key: 'services', icon: Container },
  { path: '/docker', key: 'docker', icon: Activity },
  { path: '/network', key: 'network', icon: Network },
  { path: '/access', key: 'access', icon: PlugZap },
  { path: '/gateway', key: 'gateway', icon: Globe },
  { path: '/settings', key: 'settings', icon: Settings },
]

function matches(command: Command, query: string): boolean {
  if (!query) return true
  const haystack = `${command.label} ${command.keywords ?? ''} ${command.hint ?? ''}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * The command menu: every place the panel can go and every thing it can do,
 * one keystroke away. ⌘K opens it; typing narrows it; Enter runs it.
 *
 * It offers only what already exists elsewhere in the panel. A command that
 * lives here alone would be a feature nobody finds.
 */
export function CommandPalette({
  open,
  onOpenChange,
  toggleSidebar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  toggleSidebar: () => void
}) {
  // The palette reads the preferences itself rather than being handed them:
  // it is the second place they can be changed, and a copy passed down would
  // be a second source of truth for what is currently selected.
  const { theme, setTheme } = useThemeChoice()
  const [locale, setLocale] = useLocale()
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const projects = useProjects()
  const [query, setQuery] = useState('')
  const mod = useModKey()
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const close = () => onOpenChange(false)
    const go = (path: string) => () => {
      close()
      navigate(path)
    }
    const items: Command[] = SECTIONS.map((section) => ({
      id: `go:${section.path}`,
      group: 'navigate',
      label: t(section.key),
      keywords: section.key,
      icon: section.icon,
      run: go(section.path),
    }))
    for (const project of projects.data ?? []) {
      if (project.archived) continue
      items.push({
        id: `project:${project.slug}`,
        group: 'projects',
        label: project.name,
        hint: project.slug,
        keywords: project.slug,
        icon: Boxes,
        run: go(`/projects/${encodeURIComponent(project.slug)}`),
      })
    }
    items.push({
      id: 'toggle-sidebar',
      group: 'actions',
      label: t('shortcuts.sidebar'),
      icon: PanelLeft,
      shortcut: ['['],
      run: () => {
        close()
        toggleSidebar()
      },
    })
    const themes: { value: Theme; icon: ComponentType<{ className?: string }> }[] = [
      { value: 'light', icon: Sun },
      { value: 'dark', icon: Moon },
      { value: 'system', icon: Monitor },
    ]
    for (const option of themes) {
      items.push({
        id: `theme:${option.value}`,
        group: 'preferences',
        label: `${t('theme.label')}: ${t(`theme.${option.value}`)}`,
        keywords: `theme tema ${option.value}`,
        hint: theme === option.value ? '✓' : undefined,
        icon: option.icon,
        run: () => {
          close()
          setTheme(option.value)
        },
      })
    }
    for (const option of ['en', 'pt-BR'] as Locale[]) {
      items.push({
        id: `locale:${option}`,
        group: 'preferences',
        label: `${tc('languageSelector')}: ${option === 'pt-BR' ? tc('portuguese') : tc('english')}`,
        keywords: `language idioma ${option}`,
        hint: locale === option ? '✓' : undefined,
        icon: Languages,
        run: () => {
          close()
          setLocale(option)
        },
      })
    }
    return items
  }, [projects.data, theme, locale, t, tc, onOpenChange, setTheme, setLocale, toggleSidebar])

  const visible = useMemo(() => commands.filter((command) => matches(command, query)), [commands, query])
  const groups = useMemo(() => {
    const order: Group[] = ['actions', 'navigate', 'projects', 'preferences']
    return order
      .map((group) => ({ group, items: visible.filter((command) => command.group === group) }))
      .filter((entry) => entry.items.length > 0)
  }, [visible])
  const flat = useMemo(() => groups.flatMap((entry) => entry.items), [groups])
  const current = flat[Math.min(active, Math.max(flat.length - 1, 0))]

  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlight resets whenever the query changes
  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (!current) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-command="${CSS.escape(current.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(Math.max(flat.length - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      current?.run()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Scrim />
        <Dialog.Content
          onKeyDown={onKeyDown}
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 w-[min(92vw,38rem)] -translate-x-1/2 overflow-hidden outline-none',
            'data-[state=open]:animate-pop-in',
            overlaySurface,
            'rounded-xl shadow-modal',
          )}
        >
          <Dialog.Title className="sr-only">{t('commandPalette')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('commandPlaceholder')}</Dialog.Description>
          <div className="flex h-11 items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-subtle" aria-hidden />
            <input
              // biome-ignore lint/a11y/noAutofocus: a command palette exists to take the keyboard the moment it opens
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('commandPlaceholder')}
              aria-label={t('commandPalette')}
              role="combobox"
              aria-expanded
              aria-controls="command-palette-list"
              aria-activedescendant={current ? `command-${current.id}` : undefined}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
            />
            <Kbd>esc</Kbd>
          </div>
          <div
            ref={listRef}
            id="command-palette-list"
            role="listbox"
            className="max-h-[50vh] overflow-y-auto p-1 scroll-thin"
          >
            {flat.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-subtle">{t('commandNoResults')}</div>
            ) : (
              groups.map((entry) => (
                <div key={entry.group} role="group" aria-label={t(`commandGroups.${entry.group}`)}>
                  <div className={overlayLabel}>{t(`commandGroups.${entry.group}`)}</div>
                  {entry.items.map((command) => {
                    const Icon = command.icon
                    const selected = command.id === current?.id
                    return (
                      // biome-ignore lint/a11y/useFocusableInteractive: reached through aria-activedescendant on the combobox
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox's onKeyDown runs the highlighted option
                      <div
                        key={command.id}
                        id={`command-${command.id}`}
                        data-command={command.id}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => {
                          const index = flat.indexOf(command)
                          if (index >= 0 && index !== active) setActive(index)
                        }}
                        onClick={() => command.run()}
                        className={cn(overlayItem, 'h-8 cursor-default')}
                      >
                        <Icon className="size-4" />
                        <span className="min-w-0 flex-1 truncate">{command.label}</span>
                        {command.hint ? <span className="shrink-0 text-2xs text-subtle">{command.hint}</span> : null}
                        {command.shortcut ? (
                          <span className="ml-1 flex shrink-0 items-center gap-0.5" aria-hidden>
                            {command.shortcut.map((key) => (
                              <Kbd key={key}>{key === 'mod' ? mod : key}</Kbd>
                            ))}
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          <PaletteFooter />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaletteFooter(): ReactNode {
  const mod = useModKey()
  return (
    <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-2xs text-subtle" aria-hidden>
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd>
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </div>
  )
}
