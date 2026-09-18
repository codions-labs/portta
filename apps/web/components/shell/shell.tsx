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
import { useMetricsCurrent, useStatus } from '@/lib/queries'
import { useShortcut } from '@/lib/shortcuts'
import { type Theme, useThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { moduleText } from '@/modules'
import { useModules } from '@/modules/registered'
import { activeHref, type BaseNavLabelKey, NAV_GROUPS, navItemVisible } from './nav'
import { useSidebarCollapsed } from './use-sidebar'
import { UserMenu } from './user-menu'

/**
 * The mark. Three bars of decreasing height inside a rounded square: a port,
 * and the panel's own shorthand for a host with things running on it. Small on
 * purpose — it identifies the product, it does not decorate the page.
 */

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
  const modules = useModules()
  const pathname = usePathname()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const mod = useModKey()
  const live = useLive()
  const status = useStatus()
  const metrics = useMetricsCurrent()

  const active = activeHref(pathname)
  const gateway = status.data?.gateway

  const gatewayTitle = gateway?.up ? t('gatewayUp') : t('gatewayDown')
  const hostname = metrics.data?.host?.hostname ?? metrics.data?.instance.hostname ?? null
  const hostLine = gateway ? [hostname, gateway.gatewayVersion, gateway.profile].filter(Boolean).join(' · ') : '…'

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  useShortcut({ key: 'k', mod: true }, openPalette)
  useShortcut({ key: '[' }, toggleSidebar)

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
      <ConnectionBanner state={live.state} />
      <ApplyBar readOnly={gateway?.panel.readOnly ?? false} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          data-collapsed={sidebarCollapsed}
          className={cn(
            'flex shrink-0 flex-wrap items-center transition-[width] duration-150 md:h-full md:min-h-0 md:flex-col md:flex-nowrap md:items-stretch md:overflow-hidden',
            sidebarCollapsed ? 'md:w-12' : 'md:w-56',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 px-3 pt-2.5 pb-1.5 md:flex-none md:pt-3',
              sidebarCollapsed && 'md:justify-center md:px-0',
            )}
          >
            <Brand />
            <div className={cn('min-w-0 flex-1', sidebarCollapsed && 'md:hidden')}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-ink">{t('appName')}</span>
                <GatewayStatusDot up={gateway?.up} pending={status.isPending} title={gatewayTitle} />
              </div>
              {/* What this panel is attached to, which is the one thing a person
                  with two of them open needs to tell them apart. */}
              <div className="truncate text-2xs text-subtle" title={hostLine}>
                {hostLine}
              </div>
            </div>
          </div>

          <div className={cn('order-2 w-full px-2 pb-1 md:order-none', sidebarCollapsed && 'md:px-1.5')}>
            <Tooltip label={t('commandPalette')} shortcut={['mod', 'K']}>
              <button
                type="button"
                onClick={openPalette}
                aria-label={t('commandPalette')}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md border border-line bg-surface px-2 text-xs text-subtle',
                  'transition-colors duration-100 hover:border-line-strong hover:text-muted focus-ring',
                  sidebarCollapsed && 'md:justify-center md:px-0',
                )}
              >
                <Search className="size-3.5 shrink-0" aria-hidden />
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
            className={cn(
              'order-3 flex w-full gap-1 overflow-x-auto px-2 py-1 md:order-none md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto scroll-thin',
              sidebarCollapsed && 'md:px-1.5',
            )}
          >
            {NAV_GROUPS.map((group, index) => {
              // A page a role does not hold is not in that person's rail: it
              // would answer 404, and a navigation entry that cannot be
              // followed is a worse answer than no entry.
              const items = group.items.filter((item) => navItemVisible(item, permissions, modules))
              if (items.length === 0) return null
              return (
                <div
                  key={group.labelKey ?? 'tail'}
                  className={cn('flex gap-0.5 md:flex-col', index > 0 && 'md:mt-3')}
                  role="group"
                  aria-label={group.labelKey ? t(group.labelKey) : undefined}
                >
                  {group.labelKey ? (
                    <div
                      aria-hidden="true"
                      className={cn(
                        'hidden px-2 pb-1 text-2xs font-medium text-subtle md:block',
                        sidebarCollapsed && 'md:hidden',
                      )}
                    >
                      {t(group.labelKey)}
                    </div>
                  ) : null}
                  {items.map((item) => {
                    const Icon = item.icon
                    const current = active === item.href
                    const label = item.module ? moduleText(t, item.labelKey) : t(item.labelKey as BaseNavLabelKey)
                    const link = (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        aria-label={sidebarCollapsed ? label : undefined}
                        title={sidebarCollapsed ? label : undefined}
                        className={cn(
                          'flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium whitespace-nowrap',
                          'transition-colors duration-100 focus-ring',
                          sidebarCollapsed && 'md:justify-center md:px-0',
                          current ? 'bg-fill-strong text-ink' : 'text-muted hover:bg-fill hover:text-ink',
                        )}
                      >
                        <Icon className={cn('size-4 shrink-0', current ? 'text-ink' : 'text-subtle')} />
                        <span className={cn(sidebarCollapsed && 'md:sr-only')}>{label}</span>
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
              )
            })}
          </nav>

          {/* On a phone the controls sit beside the brand, on the first row;
              on a desktop they wait at the bottom of the rail. One set of
              controls either way, moved by order rather than duplicated. */}
          <div
            className={cn(
              'order-1 flex items-center px-2 pt-2 pb-1.5 md:order-none md:mt-auto md:py-2',
              // Unfolded, the group starts on the navigation's icon axis:
              // iconButton is 24px around a centred 14px glyph, so 11px of
              // padding puts that glyph at the same 16px where the nav icons
              // and the palette's magnifier begin.
              sidebarCollapsed ? 'md:justify-center md:px-1.5' : 'md:pl-[11px]',
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
            of scrolling inside its own container. The main column is a panel
            of its own: a hairline and a lift above the canvas the sidebar
            sits on, so the content is what the eye lands on. */}
        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-surface scroll-thin',
            'border-t border-line md:my-2 md:mr-2 md:rounded-lg md:border',
          )}
        >
          {/* [&>*]:shrink-0: this column is held to the height of `main`, so a
              page's top-level children would otherwise shrink to fit, and one
              with overflow-hidden (the Overview's readings strip, a Card) would
              collapse to its border. A child that fills the leftover height has
              flex-1, grows from a basis of 0, and never needs to shrink. */}
          <div className="mx-auto flex min-h-full w-full max-w-[88rem] flex-col px-4 py-4 md:px-6 md:py-5 [&>*]:shrink-0">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} toggleSidebar={toggleSidebar} />
    </div>
  )
}
