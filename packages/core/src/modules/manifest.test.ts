import { describe, expect, it } from 'vitest'
import { ACTIVITY_KINDS } from '../activity.ts'
import {
  defineModule,
  extendVocabulary,
  MODULES,
  moduleActivityKinds,
  modulePermissions,
  moduleRoleGrants,
} from './index.ts'

const fake = defineModule({
  id: 'fake',
  name: 'Fake',
  permissions: { widget: ['read', 'operate'] },
  roles: { developer: { widget: ['read', 'operate'] }, viewer: { widget: ['read'] } },
  activityKinds: ['widget.started'],
  docs: 'docs/modules/fake',
})

describe('a module manifest', () => {
  it('refuses what would collide or mislead once composed', () => {
    expect(() => defineModule({ ...fake, id: 'Fake' })).toThrow(/module id/)
    expect(() => defineModule({ ...fake, activityKinds: ['started'] })).toThrow(/entity\.verb/)
    expect(() => defineModule({ ...fake, roles: { viewer: { gadget: ['read'] } } as never })).toThrow(
      /does not declare/,
    )
    expect(() => defineModule({ ...fake, roles: { viewer: { widget: ['destroy'] } } as never })).toThrow(
      /widget:destroy/,
    )
  })
})

describe('the shared vocabularies', () => {
  it('are unchanged by an empty registry', () => {
    const base = ACTIVITY_KINDS.filter((kind) => !moduleActivityKinds(MODULES).includes(kind))
    expect(extendVocabulary(base, moduleActivityKinds([]), 'activity kind')).toEqual(base)
    expect(modulePermissions([])).toEqual({})
  })

  it('carry the registered modules after the base', () => {
    expect(MODULES.map((module) => module.id)).toEqual(['taskflow'])
    expect(ACTIVITY_KINDS).toEqual(expect.arrayContaining([...moduleActivityKinds(MODULES)]))
  })

  it('append what a module adds, after the base', () => {
    expect(extendVocabulary(['task.created'], moduleActivityKinds([fake]), 'activity kind')).toEqual([
      'task.created',
      'widget.started',
    ])
    expect(modulePermissions([fake])).toEqual({ widget: ['read', 'operate'] })
    expect(moduleRoleGrants([fake], 'viewer')).toEqual({ widget: ['read'] })
  })

  it('refuse a name two contributors both claim', () => {
    expect(() => extendVocabulary(['widget.started'], moduleActivityKinds([fake]), 'activity kind')).toThrow(
      /duplicate activity kind/,
    )
    expect(() => modulePermissions([fake, defineModule({ ...fake, id: 'other' })])).toThrow(/already declared/)
  })
})
