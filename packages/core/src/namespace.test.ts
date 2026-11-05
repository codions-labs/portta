import { describe, expect, it } from 'vitest'
import { branchSuffix, composeNamespace, environmentNamespace, slug } from './namespace.js'

describe('namespaces', () => {
  it('normalises names for Docker and DNS', () =>
    expect(slug('Base_Empresarial/Issue#59')).toBe('base-empresarial-issue-59'))
  it('keeps the main checkout on the base name', () =>
    expect(composeNamespace('storefront', branchSuffix('main'))).toBe('storefront'))
  it('distinguishes a work branch', () =>
    expect(composeNamespace('storefront', branchSuffix('fix/59-proxy'))).toBe('storefront-fix-59-proxy'))
})

describe('new environment namespaces', () => {
  it('retains raw identity despite normalization and truncation', () => {
    const base = 'p'.repeat(70)
    const first = environmentNamespace({ base, branch: 'feature/a', workspace: '/repos/shop' })
    expect(first).not.toBe(environmentNamespace({ base, branch: 'feature-a', workspace: '/repos/shop' }))
    expect(first).not.toBe(environmentNamespace({ base: `${base}x`, branch: 'feature/a', workspace: '/repos/shop' }))
    expect(first).toMatch(/^[a-z0-9][a-z0-9-]{0,51}$/)
  })

  it('distinguishes workspaces and preserves field boundaries', () => {
    const first = environmentNamespace({ base: 'a-b', branch: 'c', workspace: '/repos/one' })
    expect(first).not.toBe(environmentNamespace({ base: 'a', branch: 'b-c', workspace: '/repos/one' }))
    expect(first).not.toBe(environmentNamespace({ base: 'a-b', branch: 'c', workspace: '/repos/two' }))
  })

  it('is stable and treats primary branches as the base environment', () => {
    const parts = { base: 'shop', workspace: '/repos/shop' }
    expect(environmentNamespace({ ...parts, branch: 'main' })).toBe(
      environmentNamespace({ ...parts, branch: 'develop' }),
    )
    expect(environmentNamespace(parts)).toBe(environmentNamespace(parts))
  })

  it('does not repeat a branch already present in the worktree directory', () => {
    expect(
      environmentNamespace({
        base: 'shop-feature-auth',
        branch: 'feature/auth',
        workspace: '/repos/shop-feature-auth',
      }),
    ).toMatch(/^shop-feature-auth-[a-f0-9]{8}$/)
  })
})
