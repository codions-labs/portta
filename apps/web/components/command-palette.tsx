'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  Boxes,
  Container,
  Copy,
  ExternalLink,
  Filter,
  Globe,
  Languages,
  LayoutDashboard,
  Link2,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  PlugZap,
  RotateCw,
  ScrollText,
  Search,
  Server,
  Settings,
  Sun,
  Terminal,
} from 'lucide-react'
import type { ContainerSummary, Environment } from 'portta-contracts'
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../lib/api/index.ts'
import { copyText } from '../lib/clipboard.ts'
import { hostAccess } from '../lib/host-access.ts'
import { type Locale, useLocale } from '../lib/i18n/use-locale.ts'
import { navigate } from '../lib/navigation.ts'
import { useCan } from '../lib/permissions.ts'
import { useEnvironments, useExposure, useMetricsCurrent, useProjects } from '../lib/queries/index.ts'
import { percentLabel } from '../lib/resources.ts'
import { serviceFromContainer } from '../lib/services.ts'
import { type Theme, useThemeChoice } from '../lib/theme.ts'
import { narrowTone } from '../lib/tone.ts'
import { useFormat } from '../lib/use-format.ts'
import { cn, folded } from '../lib/utils.ts'
import { HostAccess } from './entities/environment-row.tsx'
import { containerTone } from './status.tsx'
import { StatusDot } from './ui/badge.tsx'
import { Scrim } from './ui/dialog.tsx'
import { Kbd, useAltKey, useModKey } from './ui/kbd.tsx'
import { overlayItem, overlaySurface } from './ui/surfaces.ts'
import { useToast } from './ui/toast.tsx'

type Group = 'navigate' | 'projects' | 'actions' | 'preferences' | 'target' | 'found'
type Kind = 'service' | 'project' | 'page' | 'filter' | 'action' | 'preference'

interface Command {
  id: string
  group: Group
  /** What it is, said beside it where a search mixes everything together. */
  kind: Kind
  /** The service it acts on or opens, which is what the panel beside the list shows. */
  target?: ServiceTarget
  label: string
  /** Extra words the search should match: a slug, a synonym. */
  keywords?: string
  hint?: string
  icon: ComponentType<{ className?: string }>
  shortcut?: readonly string[]
  /** Pressed with Alt: the search box takes the plain letter. */
  altKey?: string
  run: () => void
}

interface ServiceTarget {
  environment: Environment
  container: ContainerSummary
  name: string
}

const SECTIONS: {
  path: string
  key: 'overview' | 'projects' | 'services' | 'access' | 'host' | 'docker' | 'network' | 'gateway' | 'settings'
  icon: ComponentType<{ className?: string }>
}[] = [
  { path: '/overview', key: 'overview', icon: LayoutDashboard },
  { path: '/projects', key: 'projects', icon: Boxes },
  { path: '/projects?view=services', key: 'services', icon: Container },
  { path: '/access', key: 'access', icon: PlugZap },
  { path: '/host', key: 'host', icon: Server },
  { path: '/host/containers', key: 'docker', icon: Activity },
  { path: '/host/network', key: 'network', icon: Network },
  { path: '/host/gateway', key: 'gateway', icon: Globe },
  { path: '/settings', key: 'settings', icon: Settings },
]

/** Every word has to be found; the more that stand on their own, the better the match. */
function rank(haystack: string, tokens: readonly string[], words: readonly string[]): number | null {
  if (words.length === 0) return 0
  if (!words.every((word) => haystack.includes(word))) return null
  return words.filter((word) => tokens.includes(word)).length
}

function matches(command: Command, query: string): boolean {
  if (!query) return true
  const haystack = folded(`${command.label} ${command.keywords ?? ''} ${command.hint ?? ''}`)
  return folded(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/** Each service once: replicas share a name, and an action on it reaches them all. */
function serviceTargets(environments: readonly Environment[]): ServiceTarget[] {
  return environments
    .filter((environment) => environment.presence === 'live')
    .flatMap((environment) => {
      const seen = new Set<string>()
      return environment.services.flatMap((container) => {
        const name = container.service ?? container.name
        if (seen.has(name)) return []
        seen.add(name)
        return [{ environment, container, name }]
      })
    })
}

function labelOf(target: ServiceTarget): string {
  return `${target.environment.overrides?.displayName ?? target.environment.name} / ${target.name}`
}

function bestTargets(targets: readonly ServiceTarget[], query: string): ServiceTarget[] {
  const words = folded(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return targets
    .flatMap((target) => {
      const text = folded(
        [
          target.environment.name,
          target.environment.overrides?.displayName ?? '',
          target.name,
          target.container.name,
          ...target.container.urls.map((url) => url.host),
        ].join(' '),
      )
      const score = rank(text, text.split(/[^a-z0-9]+/), words)
      return score === null ? [] : [{ target, score, length: labelOf(target).length }]
    })
    .sort((a, b) => b.score - a.score || a.length - b.length)
    .map((entry) => entry.target)
}

/**
 * The command menu: every place the panel can go and every thing it can do,
 * one keystroke away. ⌘K opens it; typing narrows it; Enter runs it. Name a
 * service and what can be done to it comes first, beside how it is doing.
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Scrim />
        {/* Mounted only while open, so nothing here polls the host until it is asked for. */}
        <PaletteContent onClose={() => onOpenChange(false)} toggleSidebar={toggleSidebar} />
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaletteContent({ onClose, toggleSidebar }: { onClose: () => void; toggleSidebar: () => void }) {
  // The palette reads the preferences itself rather than being handed them:
  // it is the second place they can be changed, and a copy passed down would
  // be a second source of truth for what is currently selected.
  const { theme, setTheme } = useThemeChoice()
  const [locale, setLocale] = useLocale()
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const toast = useToast()
  const projects = useProjects()
  const mayReadEnvironments = useCan('environment:read')
  const mayOperate = useCan('service:operate')
  const mayConsole = useCan('container:console')
  const mayReadLogs = useCan('logs:read')
  const mayReadAccess = useCan('access:read')
  const environments = useEnvironments(true, mayReadEnvironments)
  const exposure = useExposure(mayReadAccess)
  const [query, setQuery] = useState('')
  const mod = useModKey()
  const alt = useAltKey()
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const targets = useMemo(() => serviceTargets(environments.data ?? []), [environments.data])
  const found = useMemo(() => bestTargets(targets, query), [targets, query])
  const focus = found[0]

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      onClose()
      navigate(path)
    }
    const items: Command[] = SECTIONS.map((section) => ({
      id: `go:${section.path}`,
      group: 'navigate',
      kind: 'page',
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
        kind: 'project',
        label: project.name,
        keywords: project.slug,
        icon: Boxes,
        run: go(`/projects/${encodeURIComponent(project.slug)}`),
      })
    }
    if (exposure.data?.enforced) {
      items.push({
        id: 'filter:closed-sites',
        group: 'navigate',
        kind: 'filter',
        label: t('commandFilters.closedSites'),
        icon: Filter,
        run: go('/access?filter=closed'),
      })
    }
    items.push({
      id: 'toggle-sidebar',
      group: 'actions',
      kind: 'action',
      label: t('shortcuts.sidebar'),
      icon: PanelLeft,
      shortcut: ['['],
      run: () => {
        onClose()
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
        kind: 'preference',
        label: `${t('theme.label')}: ${t(`theme.${option.value}`)}`,
        keywords: `theme tema ${option.value}`,
        hint: theme === option.value ? '✓' : undefined,
        icon: option.icon,
        run: () => {
          onClose()
          setTheme(option.value)
        },
      })
    }
    for (const option of ['en', 'pt-BR'] as Locale[]) {
      items.push({
        id: `locale:${option}`,
        group: 'preferences',
        kind: 'preference',
        label: `${tc('languageSelector')}: ${option === 'pt-BR' ? tc('portuguese') : tc('english')}`,
        keywords: `language idioma ${option}`,
        hint: locale === option ? '✓' : undefined,
        icon: Languages,
        run: () => {
          onClose()
          setLocale(option)
        },
      })
    }
    return items
  }, [projects.data, exposure.data, theme, locale, t, tc, onClose, setTheme, setLocale, toggleSidebar])

  const actions = useMemo<Command[]>(() => {
    if (!focus) return []
    const { environment, container, name } = focus
    const base = `/environments/${encodeURIComponent(environment.name)}`
    const page = `${base}?service=${encodeURIComponent(name)}`
    const url = container.urls[0]?.url
    const running = container.state === 'running'
    const ours = container.ownership === 'gateway'
    const go = (path: string) => () => {
      onClose()
      navigate(path)
    }
    const action = (
      id: string,
      label: string,
      icon: Command['icon'],
      run: () => void,
      extra: Partial<Command> = {},
    ): Command => ({ id: `act:${id}`, group: 'target', kind: 'action', target: focus, label, icon, run, ...extra })
    return [
      // A database has no site: what somebody looks one up for is reaching it.
      ...(serviceFromContainer(container).access.kind === 'tcp' && running && mayReadAccess
        ? [action('connect', t('commandActions.connect'), PlugZap, go(`${page}&section=access`))]
        : []),
      ...(url
        ? [
            action('open', t('commandActions.openSite'), ExternalLink, () => {
              onClose()
              window.open(url, '_blank', 'noreferrer')
            }),
            action(
              'copy',
              t('commandActions.copyAddress'),
              Copy,
              () => {
                onClose()
                copyText(url).then(
                  () => toast.push({ tone: 'ok', title: tc('copied') }),
                  (error: unknown) =>
                    toast.push({ tone: 'danger', title: t('commandActions.copyFailed'), description: String(error) }),
                )
              },
              { shortcut: ['mod', 'C'] },
            ),
          ]
        : []),
      ...(mayReadLogs
        ? [
            action('logs', t('commandActions.logs'), ScrollText, go(`${base}?logs=${encodeURIComponent(name)}`), {
              altKey: 'L',
            }),
          ]
        : []),
      ...(url ? [action('share', t('commandActions.share'), Link2, go(`${page}&section=share`), { altKey: 'S' })] : []),
      ...(mayOperate && running && !ours
        ? [
            action(
              'restart',
              t('commandActions.restart'),
              RotateCw,
              () => {
                onClose()
                api.serviceAction(environment.name, name, 'restart').then(
                  () => toast.push({ tone: 'ok', title: t('commandActions.restarted', { name }) }),
                  (error: unknown) =>
                    toast.push({
                      tone: 'danger',
                      title: t('commandActions.failed', { name }),
                      description:
                        error instanceof ApiError
                          ? [error.message, error.hint].filter(Boolean).join(' · ')
                          : String(error),
                    }),
                )
              },
              { altKey: 'R' },
            ),
          ]
        : []),
      ...(mayConsole && running && !ours
        ? [
            action('console', t('commandActions.console'), Terminal, go(`${page}&section=console`), {
              altKey: 'C',
            }),
          ]
        : []),
      action('details', t('commandActions.details'), Container, go(page)),
    ]
  }, [focus, mayConsole, mayOperate, mayReadAccess, mayReadLogs, onClose, t, tc, toast])

  const others = useMemo<Command[]>(() => {
    const services: Command[] = found.slice(focus ? 1 : 0, 6).map((target) => ({
      id: `service:${target.environment.name}/${target.name}`,
      group: 'found',
      kind: 'service',
      target,
      label: labelOf(target),
      icon: Container,
      run: () => {
        onClose()
        navigate(
          `/environments/${encodeURIComponent(target.environment.name)}?service=${encodeURIComponent(target.name)}`,
        )
      },
    }))
    return [
      ...services,
      ...commands.filter((command) => matches(command, query)).map((c) => ({ ...c, group: 'found' as const })),
    ]
  }, [commands, focus, found, onClose, query])

  const groups = useMemo(() => {
    if (focus) {
      return [
        { group: 'target' as Group, title: labelOf(focus), items: actions },
        { group: 'found' as Group, title: t('commandGroups.found'), items: others },
      ].filter((entry) => entry.items.length > 0)
    }
    const visible = commands.filter((command) => matches(command, query))
    const order: Group[] = ['actions', 'navigate', 'projects', 'preferences']
    return order
      .map((group) => ({
        group,
        title: t(`commandGroups.${group as 'actions'}`),
        items: visible.filter((command) => command.group === group),
      }))
      .filter((entry) => entry.items.length > 0)
  }, [actions, commands, focus, others, query, t])
  const flat = useMemo(() => groups.flatMap((entry) => entry.items), [groups])
  const current = flat[Math.min(active, Math.max(flat.length - 1, 0))]
  const previewed = current?.target ?? focus

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
    } else if (event.altKey && event.code.startsWith('Key')) {
      // The code, not the key: Alt+L on a Mac types ¬.
      const shortcut = actions.find((action) => action.altKey === event.code.slice(3))
      if (shortcut) {
        event.preventDefault()
        shortcut.run()
      }
    } else if ((event.metaKey || event.ctrlKey) && event.code === 'KeyC') {
      // Selected text in the box is still the box's to copy.
      const input = inputRef.current
      if (input && input.selectionStart !== input.selectionEnd) return
      const copy = actions.find((action) => action.id === 'act:copy')
      if (copy) {
        event.preventDefault()
        copy.run()
      }
    }
  }

  return (
    <Dialog.Content
      onKeyDown={onKeyDown}
      className={cn(
        'fixed top-[10vh] left-1/2 z-50 w-[min(calc(100vw-2rem),51.25rem)] -translate-x-1/2 overflow-hidden outline-none',
        'data-[state=open]:animate-pop-in',
        overlaySurface,
        'rounded-[0.875rem] shadow-modal',
      )}
    >
      <Dialog.Title className="sr-only">{t('commandPalette')}</Dialog.Title>
      <Dialog.Description className="sr-only">{t('commandPlaceholder')}</Dialog.Description>
      <div className="flex h-13.5 items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-subtle" aria-hidden />
        <input
          ref={inputRef}
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
          className="h-full min-w-0 flex-1 bg-transparent text-base font-medium text-ink outline-none placeholder:font-normal placeholder:text-faint"
        />
        <Kbd>esc</Kbd>
      </div>
      <div className="flex min-h-0">
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-[56vh] min-w-0 flex-1 overflow-y-auto p-2 scroll-thin"
        >
          {flat.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-subtle">{t('commandNoResults')}</div>
          ) : (
            groups.map((entry) => (
              <div key={`${entry.group}:${entry.title}`} role="group" aria-label={entry.title}>
                <div className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-[0.14em] text-subtle uppercase">
                  {entry.title}
                </div>
                {entry.items.map((command, index) => {
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
                        const at = flat.indexOf(command)
                        if (at >= 0 && at !== active) setActive(at)
                      }}
                      onClick={() => command.run()}
                      className={cn(
                        overlayItem,
                        'h-9 cursor-default gap-2.5 rounded-lg px-2.5',
                        selected && 'font-semibold',
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.hint ? <span className="shrink-0 text-2xs text-subtle">{command.hint}</span> : null}
                      {entry.group === 'found' ? (
                        <span className="shrink-0 text-xs font-normal text-subtle">
                          {t(`commandKinds.${command.kind}`)}
                        </span>
                      ) : null}
                      {entry.group === 'target' && index === 0 ? <Kbd>↵</Kbd> : null}
                      {command.altKey ? (
                        <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                          <Kbd>{alt}</Kbd>
                          <Kbd>{command.altKey}</Kbd>
                        </span>
                      ) : null}
                      {command.shortcut && !(entry.group === 'found') ? (
                        <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
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
        {previewed ? <ServicePreview target={previewed} /> : null}
      </div>
      <PaletteFooter />
    </Dialog.Content>
  )
}

/** How the service in question is doing, before anything is done to it. */
function ServicePreview({ target }: { target: ServiceTarget }) {
  const { t } = useTranslation('nav', { keyPrefix: 'commandPreview' })
  const { t: tc } = useTranslation('common')
  const { bytes, uptime } = useFormat()
  const mayReadAccess = useCan('access:read')
  const exposure = useExposure(mayReadAccess)
  const metrics = useMetricsCurrent()
  const { container, environment, name } = target
  const route = container.urls[0]
  const entry = route
    ? exposure.data?.entries.find((item) => item.host.toLowerCase() === route.host.toLowerCase())
    : undefined
  const measured = metrics.data?.projects
    .flatMap((project) => project.containers)
    .find((candidate) => candidate.id === container.id)
  const state =
    container.state === 'running' && container.health !== 'none'
      ? tc(`health.${container.health}`, { defaultValue: container.health })
      : tc(`state.${container.state}`, { defaultValue: container.state })
  const label = 'mb-1 text-2xs font-semibold tracking-[0.14em] text-muted uppercase'

  return (
    <aside
      aria-label={t('aria', { name })}
      className="hidden w-65 shrink-0 space-y-3 border-l border-line bg-surface-2 p-4 md:block"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <StatusDot tone={narrowTone(containerTone(container.state, container.health)) as 'ok'} label={state} />
        <b className="min-w-0 truncate font-semibold text-ink">{name}</b>
        <span className="shrink-0 text-xs text-muted first-letter:uppercase">
          {[state, container.state === 'running' ? uptime(container.uptimeSeconds) : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      {route ? (
        <div>
          <p className={label}>{t('address')}</p>
          <span className="font-mono text-xs break-all text-ink">{route.url}</span>
        </div>
      ) : null}
      {route && exposure.data?.enforced ? (
        <div>
          <p className={label}>{t('access')}</p>
          <span className="flex flex-wrap items-center gap-1.5">
            <HostAccess mode={hostAccess(environment, route.host, exposure.data)} />
            {entry?.user ? <span className="text-xs text-muted">{t('login', { user: entry.user })}</span> : null}
          </span>
        </div>
      ) : null}
      {measured ? (
        <div>
          <p className={label}>{t('usage')}</p>
          <span className="text-sm text-ink tabular-nums">
            {[
              measured.cpuUtilisation !== null ? `CPU ${percentLabel(measured.cpuUtilisation)}` : null,
              measured.memoryUsedBytes !== null ? bytes(measured.memoryUsedBytes) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ) : null}
    </aside>
  )
}

function PaletteFooter() {
  const { t } = useTranslation('nav', { keyPrefix: 'commandFooter' })
  const mod = useModKey()
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-line px-4 py-2 text-xs text-subtle" aria-hidden>
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        {t('navigate')}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd>
        {t('run')}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
        {t('close')}
      </span>
    </div>
  )
}
