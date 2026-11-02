import { Boxes, Home, Server, Settings as SettingsIcon, ShieldCheck } from 'lucide-react'
import type { ComponentType } from 'react'

export type BaseNavLabelKey = 'overview' | 'projects' | 'access' | 'host' | 'settings'

export type NavGroupKey = 'groups.work' | 'groups.infrastructure'

export interface NavItem {
  href: string
  labelKey: BaseNavLabelKey
  /** A shorter label for the phone's bar, when the full one does not fit. */
  shortKey?: 'settingsShort'
  icon: ComponentType<{ className?: string }>
  /**
   * What somebody needs to hold for this entry to be theirs; any one of a list
   * is enough, for an entry that is a place with sections.
   *
   * Absent means everybody who reached the panel at all. The page refuses on
   * its own regardless; this is what keeps the rail from listing a page that
   * would answer 404 to the person reading it.
   */
  permission?: string | readonly string[]
}

export interface NavGroup {
  labelKey: NavGroupKey
  items: NavItem[]
}

/**
 * The tasks of a day first, then the host they happen on.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'groups.work',
    items: [
      { href: '/overview', labelKey: 'overview', icon: Home },
      { href: '/projects', labelKey: 'projects', icon: Boxes, permission: 'project:read' },
      { href: '/access', labelKey: 'access', icon: ShieldCheck, permission: 'access:read' },
    ],
  },
  {
    labelKey: 'groups.infrastructure',
    items: [
      {
        href: '/host',
        labelKey: 'host',
        icon: Server,
        permission: ['metrics:read', 'docker:read', 'gateway:read'],
      },
      // No permission on the entry: Settings is a place with sections, and every
      // role holds at least one of them (`token:read` if nothing else). Which
      // section somebody lands on is decided by `/settings` itself.
      { href: '/settings', labelKey: 'settings', shortKey: 'settingsShort', icon: SettingsIcon },
    ],
  },
]

/** Whether an entry belongs in this person's rail: a permission it needs is held. */
export function navItemVisible(item: NavItem, permissions: ReadonlySet<string>): boolean {
  if (!item.permission) return true
  const needed = typeof item.permission === 'string' ? [item.permission] : item.permission
  return needed.some((permission) => permissions.has(permission))
}

/** Which sidebar entry a path belongs to. `/projects/x/settings` is still Projects. */
export function activeHref(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0] ?? 'overview'
  // An environment is reached from a Project, and belongs under it.
  return first === 'environments' ? '/projects' : `/${first}`
}
