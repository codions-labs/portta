// What an official module adds to the permission vocabulary, and what it may not.

import { defineModule } from 'portta-core/modules'
import { describe, expect, it } from 'vitest'
import { statements, withModuleStatements } from '../src/access-control.ts'

const fake = defineModule({
  id: 'fake',
  name: 'Fake',
  permissions: { widget: ['read', 'operate'] },
  activityKinds: [],
})

describe('module statements', () => {
  // `statements` is the base vocabulary followed by the registered modules', so
  // the base is what a composition with no module answers.
  const base = withModuleStatements([])

  it('leave the base statements as they are when there are no modules', () => {
    expect(Object.keys(statements).slice(0, Object.keys(base).length)).toEqual(Object.keys(base))
    for (const [resource, actions] of Object.entries(base))
      expect(statements[resource as keyof typeof statements]).toEqual(actions)
  })

  it('follow the base statements', () => {
    const merged = withModuleStatements([fake])
    expect(merged.widget).toEqual(['read', 'operate'])
    expect(Object.keys(merged).slice(0, -1)).toEqual(Object.keys(base))
  })

  it('never redefine a base resource', () => {
    expect(() =>
      withModuleStatements([
        defineModule({ id: 'fake', name: 'Fake', permissions: { issue: ['read'] }, activityKinds: [] }),
      ]),
    ).toThrow(/issue resource/)
  })
})
