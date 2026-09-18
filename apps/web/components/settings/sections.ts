// The sections Settings is made of.
//
// One list, read by the side navigation and by the redirect that picks a
// landing section, so the two can never disagree about what somebody has. A
// section nobody can open is not shown and not redirected to. A module's
// sections follow the base ones and show only while the module is on.

import {
  type ModuleSettingsLabelKey,
  type ModuleSettingsSectionId,
  moduleSettingsSections,
  type WebModule,
} from '@/modules'

export type BaseSettingsSectionId =
  | 'general'
  | 'environment'
  | 'users'
  | 'tokens'
  | 'security'
  | 'integrations'
  | 'audit'

export interface SettingsSection {
  id: BaseSettingsSectionId | ModuleSettingsSectionId
  href: string
  /** A module's own label. Base sections are named by `sections.<id>`. */
  labelKey?: ModuleSettingsLabelKey
  /** The module the section belongs to. */
  module?: string
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

const BASE_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', href: '/settings/general', permission: 'settings:read' },
  { id: 'environment', href: '/settings/environment', permission: 'metrics:read' },
  { id: 'users', href: '/settings/users', permission: 'user:list', needsAccounts: true },
  { id: 'tokens', href: '/settings/tokens', permission: 'token:read', needsAccounts: true },
  { id: 'security', href: '/settings/security', needsAccounts: true },
  { id: 'integrations', href: '/settings/integrations', permission: 'issue:read' },
  { id: 'audit', href: '/settings/audit', permission: 'audit:read', needsAccounts: true },
]

export function withModuleSections(
  base: readonly SettingsSection[],
  modules?: readonly WebModule[],
): SettingsSection[] {
  // The helper widens what the registry's literal types already name, so the
  // section is read back as the type those literals extend.
  return [...base, ...moduleSettingsSections(modules).map((section) => section as unknown as SettingsSection)]
}

export const SETTINGS_SECTIONS: SettingsSection[] = withModuleSections(BASE_SETTINGS_SECTIONS)

export function visibleSections(options: {
  permissions: readonly string[]
  signsPeopleIn: boolean
  /** The modules this panel carries. Absent means none. */
  modules?: ReadonlySet<string> | readonly string[]
  sections?: readonly SettingsSection[]
}): SettingsSection[] {
  const held = new Set(options.permissions)
  const modules = new Set(options.modules ?? [])
  return (options.sections ?? SETTINGS_SECTIONS).filter(
    (section) =>
      (!section.needsAccounts || options.signsPeopleIn) &&
      (!section.permission || held.has(section.permission)) &&
      (!section.module || modules.has(section.module)),
  )
}
