// The sections Settings is made of.
//
// One list, read by the side navigation and by the redirect that picks a
// landing section, so the two can never disagree about what somebody has. A
// section nobody can open is not shown and not redirected to.

import { slug } from 'portta-core/browser'

export type BaseSettingsSectionId = 'general' | 'users' | 'tokens' | 'security' | 'audit'

export interface SettingsSection {
  id: BaseSettingsSectionId
  href: string
  /** What somebody must hold. Absent means anybody who reached the panel. */
  permission?: string
  /**
   * Whether this section exists at all in `open` mode.
   *
   * A panel that does not sign people in has no accounts, no tokens, no second
   * factor and nothing to audit. Showing them empty would say the feature is
   * broken rather than absent.
   */
  needsAccounts?: boolean
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', href: '/settings/general', permission: 'settings:read' },
  { id: 'users', href: '/settings/users', permission: 'user:list', needsAccounts: true },
  { id: 'tokens', href: '/settings/tokens', permission: 'token:read', needsAccounts: true },
  { id: 'security', href: '/settings/security', needsAccounts: true },
  { id: 'audit', href: '/settings/audit', permission: 'audit:read', needsAccounts: true },
]

/** One line of the rail for the gateway's `.env`: certificates and DNS read as one subject. */
export interface HostGroupItem {
  id: string
  href: string
  /** The server's group names this line shows. */
  groups: string[]
  /** Every address that opens it, so a link to `dns` still lands here. */
  slugs: string[]
}

const COMBINED: readonly string[][] = [['TLS', 'DNS']]
const ORDER = ['Projects', 'Project domain', 'Project access', 'TLS', 'Panel', 'Traefik']

/**
 * What the rail lists. Until the server has answered it lists the known groups,
 * so the rail does not jump; a group it adds later still gets its own line.
 */
export function hostGroupItems(available: readonly string[] = [...ORDER, 'DNS']): HostGroupItem[] {
  const combined = new Set(COMBINED.flatMap(([, ...rest]) => rest))
  const lead = available.filter((group) => !combined.has(group))
  const rank = (group: string) => {
    const at = ORDER.indexOf(group)
    return at < 0 ? ORDER.length : at
  }
  return [...lead]
    .sort((a, b) => rank(a) - rank(b))
    .map((group) => {
      const groups = (COMBINED.find(([first]) => first === group) ?? [group]).filter((name) => available.includes(name))
      const id = slug(group)
      return { id, href: `/settings/general/${id}`, groups, slugs: groups.map(slug) }
    })
}

export function visibleSections(options: {
  permissions: readonly string[]
  signsPeopleIn: boolean
  sections?: readonly SettingsSection[]
}): SettingsSection[] {
  const held = new Set(options.permissions)
  return (options.sections ?? SETTINGS_SECTIONS).filter(
    (section) =>
      (!section.needsAccounts || options.signsPeopleIn) && (!section.permission || held.has(section.permission)),
  )
}
