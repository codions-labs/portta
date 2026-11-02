'use client'

// The frame every panel page is rendered into: the rail, the controls, the
// connection banner and the command palette.
//
// One client boundary. The pages inside it are Server Components, and what they
// return is passed through as `children` — the shell never re-renders because a
// page changed, and a page never has to know the shell exists.

import { BookOpen, Languages, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType, type ReactNode, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApplyBar } from '@/components/apply-bar'
import { CommandPalette } from '@/components/command-palette'
import { ConnectionBanner } from '@/components/connection-banner'
import { GatewayStatusDot } from '@/components/gateway-status-dot'
import { PorttaBrand as Brand } from '@/components/ui/brand'
import { Kbd, useModKey } from '@/components/ui/kbd'
import { Menu, MenuContent, MenuRadio, MenuRadioGroup, MenuTrigger } from '@/components/ui/menu'
import { iconButton } from '@/components/ui/surfaces'
import { Tooltip } from '@/components/ui/tooltip'
import { type Locale, useLocale } from '@/lib/i18n/use-locale'
import { useLive } from '@/lib/live'
import { usePrincipal } from '@/lib/principal'
import { useDevelopmentOverview, useMetricsCurrent, useStatus } from '@/lib/queries'
import { useShortcut } from '@/lib/shortcuts'
import { type Theme, useThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { activeHref, NAV_GROUPS, navItemVisible } from './nav'
import { useSidebarCollapsed } from './use-sidebar'
import { UserMenu } from './user-menu'

const THEME_ICON: Record<Theme, ComponentType<{ className?: string }>> = { light: Sun, dark: Moon, system: Monitor }

/**
 * The controls that belong to the panel rather than to a page: language,
 * theme, the documentation, the sidebar. Small icon buttons, because they
 * are used once a week and looked at all day.
 */
function ShellControls({
  docs,
  collapsed,
  toggleSidebar,
  vertical,
}: {
  docs: boolean
  collapsed: boolean
  toggleSidebar: () => void
  vertical: boolean
}) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const [locale, setLocale] = useLocale()
  const { theme, setTheme } = useThemeChoice()
  const ThemeIcon = THEME_ICON[theme]

  return (
    <div className={cn('flex items-center gap-0.5', vertical && 'md:flex-col')}>
      <Menu>
        <Tooltip label={tc('languageSelectorTitle')}>
          <MenuTrigger className={iconButton} aria-label={tc('languageSelector')}>
            <Languages />
          </MenuTrigger>
        </Tooltip>
        <MenuContent align={vertical ? 'start' : 'end'} side={vertical ? 'right' : 'bottom'}>
          <MenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <MenuRadio value="en">{tc('english')}</MenuRadio>
            <MenuRadio value="pt-BR">{tc('portuguese')}</MenuRadio>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <Menu>
        <Tooltip label={t('theme.label')}>
          <MenuTrigger className={iconButton} aria-label={t('toggleTheme')}>
            <ThemeIcon />
          </MenuTrigger>
        </Tooltip>
        <MenuContent align={vertical ? 'start' : 'end'} side={vertical ? 'right' : 'bottom'}>
          <MenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <MenuRadio value="light" icon={<Sun />}>
              {t('theme.light')}
            </MenuRadio>
            <MenuRadio value="dark" icon={<Moon />}>
              {t('theme.dark')}
            </MenuRadio>
            <MenuRadio value="system" icon={<Monitor />}>
              {t('theme.system')}
            </MenuRadio>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {docs ? (
        <Tooltip label={t('documentation')}>
          <Link href="/docs" className={iconButton} aria-label={t('documentation')}>
            <BookOpen />
          </Link>
        </Tooltip>
      ) : null}
      <Tooltip label={collapsed ? t('expandSidebar') : t('collapseSidebar')} shortcut={['[']}>
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(iconButton, 'hidden md:inline-flex')}
          aria-controls="section-navigation"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </Tooltip>
      <UserMenu />
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('nav')
  const permissions = new Set(usePrincipal().permissions)
  const pathname = usePathname()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const mod = useModKey()
  const live = useLive()
  const status = useStatus()
  const metrics = useMetricsCurrent()
  const overview = useDevelopmentOverview()

  const active = activeHref(pathname)
  const gateway = status.data?.gateway
  const attention = overview.data?.attention.length ?? 0

  const gatewayTitle = gateway?.up ? t('gatewayUp') : t('gatewayDown')
  const hostname = metrics.data?.host?.hostname ?? metrics.data?.instance.hostname ?? null
  const hostDetail = gateway ? [gateway.gatewayVersion, gateway.profile].filter(Boolean).join(' · ') : '…'

  // A page a role does not hold is not in that person's rail: it would answer
  // 404, and a navigation entry that cannot be followed is a worse answer than
  // no entry.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => navItemVisible(item, permissions)),
  })).filter((group) => group.items.length > 0)
  const hostVisible = groups.some((group) => group.items.some((item) => item.href === '/host'))

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  useShortcut({ key: 'k', mod: true }, openPalette)
  useShortcut({ key: '[' }, toggleSidebar)

  const hostCard = (
    <>
      <GatewayStatusDot up={gateway?.up} pending={status.isPending} title={gatewayTitle} />
      <span className="min-w-0 flex-1">
        {/* What this panel is attached to, which is the one thing a person with
            two of them open needs to tell them apart. */}
        <span className="block truncate text-sm font-semibold text-ink">{hostname ?? t('host')}</span>
        <span className="block truncate text-xs text-subtle" title={hostDetail}>
          {hostDetail}
        </span>
      </span>
    </>
  )
  const hostCardClass = cn(
    'hidden items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 md:flex',
    sidebarCollapsed && 'md:hidden',
  )

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ConnectionBanner state={live.state} />
      <ApplyBar readOnly={gateway?.panel.readOnly ?? false} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          data-collapsed={sidebarCollapsed}
          className={cn(
            'flex shrink-0 flex-wrap items-center border-b border-line bg-sidebar transition-[width] duration-150',
            'md:h-full md:min-h-0 md:flex-col md:flex-nowrap md:items-stretch md:gap-1 md:overflow-hidden md:border-r md:border-b-0 md:p-4',
            sidebarCollapsed ? 'md:w-16 md:px-3' : 'md:w-66',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 md:flex-none md:px-2 md:pt-0 md:pb-3',
              sidebarCollapsed && 'md:justify-center md:px-0',
            )}
          >
            <Link href="/overview" className="flex min-w-0 items-center gap-2.5 rounded-md focus-ring">
              <Brand />
              <span
                className={cn(
                  'font-heading text-xl font-bold tracking-tight text-ink',
                  sidebarCollapsed && 'md:hidden',
                )}
              >
                {t('appName')}
              </span>
            </Link>
            {/* Where the host card is not drawn, the state of the gateway still is. */}
            <span className={cn('md:hidden', sidebarCollapsed && 'md:inline-flex')}>
              <GatewayStatusDot up={gateway?.up} pending={status.isPending} title={gatewayTitle} />
            </span>
          </div>

          {hostVisible ? (
            <Link
              href="/host"
              className={cn(hostCardClass, 'transition-colors duration-100 hover:bg-surface-2 focus-ring')}
            >
              {hostCard}
            </Link>
          ) : (
            <div className={hostCardClass}>{hostCard}</div>
          )}

          <div className="order-2 w-full px-3 pb-2.5 md:order-none md:mt-2 md:mb-3 md:px-0 md:pb-0">
            <Tooltip label={t('commandPalette')} shortcut={['mod', 'K']}>
              <button
                type="button"
                onClick={openPalette}
                aria-label={t('commandPalette')}
                className={cn(
                  'flex h-10 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-sm font-medium text-subtle',
                  'transition-colors duration-100 hover:border-line-strong hover:text-ink focus-ring',
                  sidebarCollapsed && 'md:justify-center md:px-0',
                )}
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className={cn('flex-1 truncate text-left', sidebarCollapsed && 'md:sr-only')}>
                  {t('commandPalette')}
                </span>
                <span className={cn('flex items-center gap-0.5', sidebarCollapsed && 'md:hidden')} aria-hidden>
                  <Kbd>{mod}</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
            </Tooltip>
          </div>

          <nav
            id="section-navigation"
            aria-label={t('sections')}
            className="hidden min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin md:flex"
          >
            {groups.map((group) => (
              <div key={group.labelKey} className="flex flex-col gap-1" role="group" aria-label={t(group.labelKey)}>
                <div
                  aria-hidden="true"
                  className={cn(
                    'px-3 pt-1 pb-1 text-2xs font-semibold tracking-[0.14em] text-subtle uppercase',
                    sidebarCollapsed && 'md:hidden',
                  )}
                >
                  {t(group.labelKey)}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const current = active === item.href
                  const label = t(item.labelKey)
                  const count = item.href === '/overview' ? attention : 0
                  const link = (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      aria-label={sidebarCollapsed ? label : undefined}
                      title={sidebarCollapsed ? label : undefined}
                      className={cn(
                        'flex h-10 shrink-0 items-center gap-3 rounded-xl px-3 text-base font-medium whitespace-nowrap',
                        'transition-colors duration-100 focus-ring',
                        sidebarCollapsed && 'md:justify-center md:px-0',
                        current
                          ? 'bg-accent text-accent-fg shadow-raised'
                          : 'text-muted hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn(sidebarCollapsed && 'md:sr-only')}>{label}</span>
                      {count > 0 ? (
                        <span
                          className={cn(
                            'ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums',
                            current ? 'bg-accent-fg text-accent' : 'bg-danger/10 text-danger',
                            sidebarCollapsed && 'md:hidden',
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
                    </Link>
                  )
                  return sidebarCollapsed ? (
                    <Tooltip key={item.href} label={label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )
                })}
              </div>
            ))}
          </nav>

          {/* On a phone the controls sit beside the brand, on the first row;
              on a desktop they wait at the bottom of the rail. One set of
              controls either way, moved by order rather than duplicated. */}
          <div
            className={cn(
              'order-1 flex items-center px-2 py-2 md:order-none md:mt-auto md:px-0 md:pt-3 md:pb-0',
              sidebarCollapsed && 'md:justify-center',
            )}
          >
            <ShellControls
              docs={Boolean(status.data?.gateway.panel.docs)}
              collapsed={sidebarCollapsed}
              toggleSidebar={toggleSidebar}
              vertical={sidebarCollapsed}
            />
          </div>
        </aside>

        {/* min-w-0: a flex item will not shrink below its content without it,
            which is what let a wide table push the whole page sideways instead
            of scrolling inside its own container. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scroll-thin">
          {/* [&>*]:shrink-0: this column is held to the height of `main`, so a
              page's top-level children would otherwise shrink to fit, and one
              with overflow-hidden (the Overview's readings strip, a Card) would
              collapse to its border. A child that fills the leftover height has
              flex-1, grows from a basis of 0, and never needs to shrink. */}
          <div className="mx-auto flex min-h-full w-full max-w-[84rem] flex-col px-4 py-5 md:px-8 md:py-8 [&>*]:shrink-0">
            {children}
          </div>
        </main>

        <nav
          aria-label={t('sections')}
          className="grid shrink-0 auto-cols-fr grid-flow-col border-t border-line bg-sidebar md:hidden"
        >
          {groups
            .flatMap((group) => group.items)
            .map((item) => {
              const Icon = item.icon
              const current = active === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 text-2xs font-semibold focus-ring-inset',
                    current ? 'text-ink' : 'text-subtle',
                  )}
                >
                  <Icon className="size-4" />
                  {t(item.shortKey ?? item.labelKey)}
                </Link>
              )
            })}
        </nav>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} toggleSidebar={toggleSidebar} />
    </div>
  )
}
