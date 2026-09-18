// The panel UI's half of the official modules.
//
// The one place code outside a module reaches it. Each entry names a manifest
// from `portta-core/modules` and what the module adds to the UI: entries in the
// rail, tabs on a Project, sections of Settings, and translation namespaces.
// `components/shell/nav.ts`, `components/projects/project-tabs.tsx`,
// `components/settings/sections.ts` and `lib/i18n/resources.ts` keep their own
// lists as the base and append what is here.
//
// Every registered module is compiled in and on; a Client Component reads the
// ids `lib/server/modules.ts` resolves rather than this registry, so the list
// is decided in one place per render.

import type { ModuleManifest } from 'portta-core/modules'
import type { ComponentType } from 'react'
import { taskflowWebModule } from './taskflow/index.ts'

export interface ModuleNavItem {
  /** The rail group the entry joins. */
  readonly group: 'groups.development' | 'groups.infrastructure'
  readonly href: string
  /** A key in the module's own namespace, written `namespace:key`. */
  readonly labelKey: string
  readonly icon: ComponentType<{ className?: string }>
  readonly permission?: string
}

export interface ModuleProjectTab {
  readonly id: string
  /** A key in the module's own namespace, written `namespace:key`. */
  readonly labelKey: string
  /** Below `/projects/<slug>/`, and the first segment is the tab's id. */
  readonly path: string
  /** What somebody must hold for the tab to be theirs. The page refuses on its own regardless. */
  readonly permission?: string
  /** Other first segments that are this tab too, such as a module's own settings beside its list. */
  readonly aliases?: readonly string[]
}

export interface ModuleSettingsSection {
  readonly id: string
  readonly href: string
  /** A key in the module's own namespace, written `namespace:key`. */
  readonly labelKey: string
  readonly permission?: string
  readonly needsAccounts?: boolean
}

export type ModuleLocale = 'en' | 'pt-BR'

export interface WebModule {
  readonly manifest: ModuleManifest
  readonly nav?: readonly ModuleNavItem[]
  readonly projectTabs?: readonly ModuleProjectTab[]
  readonly settingsSections?: readonly ModuleSettingsSection[]
  /** Namespace name to messages, per locale. A namespace never reuses a base one. */
  readonly messages?: { readonly [L in ModuleLocale]: { readonly [namespace: string]: object } }
}

export const WEB_MODULES = [taskflowWebModule] as const satisfies readonly WebModule[]

type Registered = (typeof WEB_MODULES)[number]
type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
  ? I
  : never
type NavLabelOf<M> = M extends { readonly nav: readonly { readonly labelKey: infer K extends string }[] } ? K : never
type TabOf<M> = M extends { readonly projectTabs: readonly (infer T extends ModuleProjectTab)[] } ? T : never
type SectionOf<M> = M extends { readonly settingsSections: readonly (infer S extends ModuleSettingsSection)[] }
  ? S
  : never
type MessagesOf<M, L extends ModuleLocale> = M extends { readonly messages: { readonly [K in L]: infer R } } ? R : never

/** What the registered modules add to each vocabulary. `never` for none. */
export type ModuleNavLabelKey = NavLabelOf<Registered>
export type ModuleProjectTabId = TabOf<Registered>['id']
export type ModuleSettingsSectionId = SectionOf<Registered>['id']
export type ModuleSettingsLabelKey = SectionOf<Registered>['labelKey']
export type ModuleResources<L extends ModuleLocale> = [MessagesOf<Registered, L>] extends [never]
  ? Record<never, never>
  : UnionToIntersection<MessagesOf<Registered, L>>

/**
 * A module's own label, written `namespace:key`, from a component that
 * translates by a base namespace.
 *
 * The key names a namespace the calling component's `t` is not typed for, so it
 * is resolved untyped here, once, rather than cast at each call site;
 * `withModuleResources` is what guarantees the namespace exists.
 */
export function moduleText(t: (...args: never[]) => unknown, key: string): string {
  return String((t as unknown as (key: string) => unknown)(key))
}

/** Each module's contributions, carrying the id that decides whether it shows. */
export function moduleNavItems(modules: readonly WebModule[] = WEB_MODULES): (ModuleNavItem & { module: string })[] {
  return modules.flatMap((module) => (module.nav ?? []).map((item) => ({ ...item, module: module.manifest.id })))
}

export function moduleProjectTabs(
  modules: readonly WebModule[] = WEB_MODULES,
): (ModuleProjectTab & { module: string })[] {
  return modules.flatMap((module) => (module.projectTabs ?? []).map((tab) => ({ ...tab, module: module.manifest.id })))
}

export function moduleSettingsSections(
  modules: readonly WebModule[] = WEB_MODULES,
): (ModuleSettingsSection & { module: string })[] {
  return modules.flatMap((module) =>
    (module.settingsSections ?? []).map((section) => ({ ...section, module: module.manifest.id })),
  )
}

/**
 * The base namespaces of one locale, then every module's.
 *
 * Every registered module's messages are loaded, whether or not a page renders
 * them: a namespace nobody renders costs nothing, and a translation that
 * depends on the environment is one more thing that differs between two panels.
 */
export function withModuleResources<B extends Record<string, object>, L extends ModuleLocale>(
  base: B,
  locale: L,
  modules: readonly WebModule[] = WEB_MODULES,
): B & ModuleResources<L> {
  const merged: Record<string, object> = { ...base }
  for (const module of modules) {
    for (const [namespace, messages] of Object.entries(module.messages?.[locale] ?? {})) {
      if (namespace in merged)
        throw new Error(`module ${module.manifest.id}: the ${namespace} namespace already exists`)
      merged[namespace] = messages
    }
  }
  return merged as B & ModuleResources<L>
}
