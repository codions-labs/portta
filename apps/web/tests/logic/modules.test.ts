import { Boxes } from 'lucide-react'
import { defineModule } from 'portta-core/modules'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTIONS, visibleSections, withModuleSections } from '@/components/settings/sections'
import { NAV_GROUPS, navItemVisible, withModuleNav } from '@/components/shell/nav'
import { RESOURCES } from '@/lib/i18n/resources'
import { registeredModuleIds } from '@/lib/server/modules'
import { moduleProjectTabs, type WebModule, withModuleResources } from '@/modules'

const fake: WebModule = {
  manifest: defineModule({ id: 'fake', name: 'Fake', permissions: { widget: ['read'] }, activityKinds: [] }),
  nav: [
    { group: 'groups.development', href: '/widgets', labelKey: 'fake:nav', icon: Boxes, permission: 'widget:read' },
  ],
  projectTabs: [{ id: 'widgets', labelKey: 'fake:tab', path: 'widgets' }],
  settingsSections: [
    { id: 'widgets', href: '/settings/widgets', labelKey: 'fake:settings', permission: 'widget:read' },
  ],
  messages: { en: { fake: { nav: 'Widgets' } }, 'pt-BR': { fake: { nav: 'Widgets' } } },
}

describe('panel modules', () => {
  it('keep the base rail and Settings, and show a registered module only while it is on', () => {
    expect(withModuleNav(NAV_GROUPS, [])).toEqual(NAV_GROUPS)
    const moduleItems = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.module)
    expect(moduleItems.map((item) => item.module)).toEqual(['taskflow'])
    const held = new Set(
      NAV_GROUPS.flatMap((group) => group.items).flatMap((item) => (item.permission ? [item.permission] : [])),
    )
    expect(moduleItems.some((item) => navItemVisible(item, held, new Set()))).toBe(false)
    expect(moduleItems.every((item) => navItemVisible(item, held, new Set(['taskflow'])))).toBe(true)
    const owner = SETTINGS_SECTIONS.flatMap((section) => (section.permission ? [section.permission] : []))
    expect(visibleSections({ permissions: owner, signsPeopleIn: true }).map((section) => section.id)).not.toContain(
      'taskflow',
    )
    expect(visibleSections({ permissions: owner, signsPeopleIn: true, modules: ['taskflow'] }).at(-1)?.id).toBe(
      'taskflow',
    )
    expect(Object.keys(RESOURCES.en)).toEqual(Object.keys(RESOURCES['pt-BR']))
    expect(Object.keys(RESOURCES.en)).toEqual(
      expect.arrayContaining(['taskflow', 'taskflow-worktrees', 'taskflow-runs']),
    )
    expect(Object.keys(RESOURCES.en)).not.toContain('fake')
  })

  it('append an entry to the rail group it names, shown only while the module is on', () => {
    const entry = withModuleNav(NAV_GROUPS, [fake])[0]?.items.at(-1)
    if (!entry) throw new Error('the development group lost its entries')
    expect(entry).toMatchObject({ href: '/widgets', module: 'fake' })
    expect(navItemVisible(entry, new Set(['widget:read']), new Set(['fake']))).toBe(true)
    expect(navItemVisible(entry, new Set(['widget:read']), new Set())).toBe(false)
    expect(navItemVisible(entry, new Set(), new Set(['fake']))).toBe(false)
  })

  it('add a Settings section after the base ones, for a module that is on', () => {
    const sections = withModuleSections(SETTINGS_SECTIONS, [fake])
    const owner = sections.flatMap((section) => (section.permission ? [section.permission] : []))
    expect(visibleSections({ permissions: owner, signsPeopleIn: true, sections }).at(-1)?.id).toBe('audit')
    expect(
      visibleSections({ permissions: owner, signsPeopleIn: true, sections, modules: ['fake'] }).at(-1),
    ).toMatchObject({ id: 'widgets', labelKey: 'fake:settings' })
  })

  it('add project tabs and translation namespaces, refusing a namespace that exists', () => {
    expect(moduleProjectTabs([fake])).toEqual([
      { id: 'widgets', labelKey: 'fake:tab', path: 'widgets', module: 'fake' },
    ])
    expect(withModuleResources({ common: {} }, 'en', [fake])).toEqual({ common: {}, fake: { nav: 'Widgets' } })
    expect(() => withModuleResources({ fake: {} }, 'en', [fake])).toThrow(/fake namespace already exists/)
  })

  it('are every module the build registers', () => {
    expect(registeredModuleIds([fake])).toEqual(['fake'])
    expect(registeredModuleIds()).toEqual(['taskflow'])
  })
})
