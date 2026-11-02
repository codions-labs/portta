import {
  Activity,
  Boxes,
  Container,
  Globe,
  LayoutDashboard,
  Network,
  PlugZap,
  Settings as SettingsIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'

export type BaseNavLabelKey =
  | 'overview'
  | 'projects'
  | 'services'
  | 'docker'
  | 'network'
  | 'access'
  | 'gateway'
  | 'settings'

export type NavGroupKey = 'groups.infrastructure'

export interface NavItem {
  href: string
  labelKey: BaseNavLabelKey
  icon: ComponentType<{ className?: string }>
  /**
   * What somebody needs to hold for this entry to be theirs.
   *
   * Absent means everybody who reached the panel at all. The page refuses on
   * its own regardless; this is what keeps the rail from listing a page that
   * would answer 404 to the person reading it.
   */
  permission?: string
}

export interface NavGroup {
  /** Null for the trailing items that belong to no group. */
  labelKey: NavGroupKey | null
  items: NavItem[]
}

/**
 * Where a day starts, then the technical perspectives over the same host,
 * then Settings alone at the end.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: null,
    items: [
      { href: '/overview', labelKey: 'overview', icon: LayoutDashboard },
      { href: '/projects', labelKey: 'projects', icon: Boxes, permission: 'project:read' },
    ],
  },
  {
    labelKey: 'groups.infrastructure',
    items: [
      { href: '/services', labelKey: 'services', icon: Container, permission: 'service:read' },
      { href: '/docker', labelKey: 'docker', icon: Activity, permission: 'docker:read' },
      { href: '/network', labelKey: 'network', icon: Network, permission: 'gateway:read' },
      { href: '/access', labelKey: 'access', icon: PlugZap, permission: 'access:read' },
      { href: '/gateway', labelKey: 'gateway', icon: Globe, permission: 'gateway:read' },
    ],
  },
  {
    labelKey: null,
    // No permission on the entry: Settings is a place with sections, and every
    // role holds at least one of them (`token:read` if nothing else). Which
    // section somebody lands on is decided by `/settings` itself.
    items: [{ href: '/settings', labelKey: 'settings', icon: SettingsIcon }],
  },
]

/** Whether an entry belongs in this person's rail: the permission it needs is held. */
export function navItemVisible(item: NavItem, permissions: ReadonlySet<string>): boolean {
  return !item.permission || permissions.has(item.permission)
}

/** Which sidebar entry a path belongs to. `/projects/x/settings` is still Projects. */
export function activeHref(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0] ?? 'overview'
  // An environment is reached from a Project, and belongs under it.
  return first === 'environments' ? '/projects' : `/${first}`
}
