import { describe, expect, it } from 'vitest'
import { fitLabel, hostLabel, MAX_LABEL, shortHash } from './hostname.js'

describe('the hostname label', () => {
  it('is project first, the way Traefik routes it', () => {
    expect(hostLabel({ project: 'storefront', service: 'web' })).toBe('storefront-web')
  })

  it('separates a context unambiguously', () => {
    expect(hostLabel({ project: 'shop', service: 'web', context: 'pr-9' })).toBe('shop-web--pr-9')
  })

  it('normalises anything a branch name can contain', () => {
    // `feature/auth/login` can never introduce a `--` that would be read back
    // as a component boundary.
    expect(hostLabel({ project: 'shop', service: 'web', context: 'feature/auth/login' })).toBe(
      'shop-web--feature-auth-login',
    )
  })

  it('collapses runs, so no component can contain the separator', () => {
    expect(hostLabel({ project: 'a__b', service: 'c   d' })).toBe('a-b-c-d')
  })
})

describe('length', () => {
  it('leaves a label that fits completely alone', () => {
    expect(fitLabel('short')).toBe('short')
  })

  it('keeps two over-long names apart instead of truncating them onto each other', () => {
    // Truncation alone would make these the same label, and Traefik would
    // route both to whichever container it matched first.
    const a = fitLabel(`web--${'a'.repeat(80)}--one`)
    const b = fitLabel(`web--${'a'.repeat(80)}--two`)
    expect(a).not.toBe(b)
    expect(a.length).toBeLessThanOrEqual(MAX_LABEL)
    expect(b.length).toBeLessThanOrEqual(MAX_LABEL)
  })

  it('never ends a trimmed label on a dash', () => {
    const label = fitLabel(`${'ab-'.repeat(30)}`)
    expect(label).not.toMatch(/-$/)
    expect(label.length).toBeLessThanOrEqual(MAX_LABEL)
  })

  it('is stable: the same input always gives the same label', () => {
    const input = { project: 'x'.repeat(70), service: 'web' }
    expect(hostLabel(input)).toBe(hostLabel(input))
  })
})

describe('the digest', () => {
  it('is stable and distinguishes inputs', () => {
    expect(shortHash('a')).toBe(shortHash('a'))
    expect(shortHash('a')).not.toBe(shortHash('b'))
  })
})
