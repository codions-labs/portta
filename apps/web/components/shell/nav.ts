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
import { type ModuleNavLabelKey, moduleNavItems, type WebModule } from '@/modules'

export type BaseNavLabelKey =
  | 'overview'
  | 'projects'
  | 'services'
  | 'docker'
  | 'network'
  | 'access'
  | 'gateway'
  | 'settings'

export type NavLabelKey = BaseNavLabelKey | ModuleNavLabelKey

export type NavGroupKey = 'groups.development' | 'groups.infrastructure'

export interface NavItem {
  href: string
  labelKey: NavLabelKey
  icon: ComponentType<{ className?: string }>
  /**
   * What somebody needs to hold for this entry to be theirs.
   *
   * Absent means everybody who reached the panel at all. The page refuses on
   * its own regardless; this is what keeps the rail from listing a page that
   * would answer 404 to the person reading it.
   */
  permission?: string
  /** The module the entry belongs to; it shows only while that module is on. */
  module?: string
}

export interface NavGroup {
  /** Null for the trailing items that belong to no group. */
  labelKey: NavGroupKey | null
  items: NavItem[]
}

/**
 * Two groups and a tail. Development is where a day starts; infrastructure
 * is the set of technical perspectives over the same host. Settings sits
 * alone at the end because it is neither.
 */
const BASE_NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'groups.development',
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

/**
 * The base groups with each module's entries appended to the group they name.
 *
 * Appended, never interleaved: the base order is a decision, and a module adds
 * to it rather than reopening it.
 */
export function withModuleNav(groups: readonly NavGroup[], modules?: readonly WebModule[]): NavGroup[] {
  const added = moduleNavItems(modules)
  return groups.map((group) => ({
    ...group,
    items: [
      ...group.items,
      ...added
        .filter((item) => item.group === group.labelKey)
        .map(({ group: _group, labelKey, ...item }) => ({ ...item, labelKey: labelKey as NavLabelKey })),
    ],
  }))
}

export const NAV_GROUPS: NavGroup[] = withModuleNav(BASE_NAV_GROUPS)

/** Whether an entry belongs in this person's rail: held, and its module on. */
export function navItemVisible(item: NavItem, permissions: ReadonlySet<string>, modules: ReadonlySet<string>): boolean {
  return (!item.permission || permissions.has(item.permission)) && (!item.module || modules.has(item.module))
}

/** Which sidebar entry a path belongs to. `/projects/x/activity` is still Projects. */
export function activeHref(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0] ?? 'overview'
  // An environment is reached from a Project, and belongs under it.
  return first === 'environments' ? '/projects' : `/${first}`
}
