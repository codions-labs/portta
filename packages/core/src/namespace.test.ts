import { describe, expect, it } from 'vitest'
import { branchSuffix, composeNamespace, slug } from './namespace.js'

describe('namespaces', () => {
  it('normalises names for Docker and DNS', () =>
    expect(slug('Base_Empresarial/Issue#59')).toBe('base-empresarial-issue-59'))
  it('keeps the main checkout on the base name', () =>
    expect(composeNamespace('storefront', branchSuffix('main'))).toBe('storefront'))
  it('distinguishes a work branch', () =>
    expect(composeNamespace('storefront', branchSuffix('fix/59-proxy'))).toBe('storefront-fix-59-proxy'))
})
