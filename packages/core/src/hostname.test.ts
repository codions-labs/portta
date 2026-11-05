import { describe, expect, it } from 'vitest'
import { fitLabel, hostLabel, hostLabelFromLabels, hostnameFor, MAX_LABEL, shareLabel, shortHash } from './hostname.js'

describe('the hostname label', () => {
  it('is project first, the way Traefik routes it', () => {
    expect(hostLabel({ project: 'storefront', service: 'web' })).toBe('storefront--web')
    expect(hostLabel({ project: 'a-b', service: 'c' })).toBe('a-b--c')
    expect(hostLabel({ project: 'a', service: 'b-c' })).toBe('a--b-c')
  })

  it('separates a context unambiguously', () => {
    expect(hostLabel({ project: 'shop', service: 'web', context: 'pr-9' })).toBe('shop--web--pr-9')
  })

  it('normalises anything a branch name can contain', () => {
    // `feature/auth/login` can never introduce a `--` that would be read back
    // as a component boundary.
    expect(hostLabel({ project: 'shop', service: 'web', context: 'feature/auth/login' })).toBe(
      'shop--web--feature-auth-login',
    )
  })

  it('collapses runs, so no component can contain the separator', () => {
    expect(hostLabel({ project: 'a__b', service: 'c   d' })).toBe('a-b--c-d')
  })

  it('avoids reserved IDNA positions for two-character namespaces', () => {
    expect(hostLabel({ project: 'go', service: 'api' })).toBe('env-go--api')
  })

  it('refuses empty fields and controls before hashing', () => {
    expect(() => hostLabel({ project: '---', service: 'api' })).toThrow('project')
    expect(() => hostLabel({ project: 'shop', service: '💥' })).toThrow('service')
    expect(() => hostLabel({ project: 'shop', service: 'api', context: '---' })).toThrow('context')
    expect(() => hostLabel({ project: 'shop\u0000api', service: 'web' })).toThrow('control')
  })
})

describe('Docker hostname metadata', () => {
  it('uses a validated canonical label without removing its boundaries', () => {
    expect(hostLabelFromLabels({ 'portta.hostname': 'shop--api--pr-4' }, 'ignored')).toBe('shop--api--pr-4')
    expect(() => hostLabelFromLabels({ 'portta.hostname': 'go--api' }, 'ignored')).toThrow('invalid hostname')
    expect(() => hostLabelFromLabels({ 'portta.hostname': 'other.example.com' }, 'ignored')).toThrow('invalid hostname')
  })

  it('derives Compose labels with the same fitting and context as the gateway', () => {
    const parts = { project: 'project_'.repeat(11), service: 'api', context: 'feature/auth' }
    expect(
      hostLabelFromLabels(
        {
          'com.docker.compose.project': parts.project,
          'com.docker.compose.service': parts.service,
          'portta.context': parts.context,
        },
        'ignored',
      ),
    ).toBe(hostLabel(parts))
  })

  it('fits standalone containers using their original identity', () => {
    const name = 'Standalone_'.repeat(10)
    const label = hostLabelFromLabels({}, name)
    expect(label).toHaveLength(MAX_LABEL)
    expect(label.endsWith(`-${shortHash(name)}`)).toBe(true)
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

  it('hashes original fields rather than their normalized concatenation', () => {
    const project = 'long-project-'.repeat(7)
    expect(hostLabel({ project, service: 'a_b' })).not.toBe(hostLabel({ project, service: 'a-b' }))
  })

  it('reserves the share marker and id inside the DNS budget', () => {
    const label = shareLabel({ project: 'long-project-'.repeat(8), service: 'web', id: 'ab12cd34' })
    expect(label).toHaveLength(MAX_LABEL)
    expect(label).toMatch(/--share-ab12cd34$/)
    expect(shareLabel({ project: 'shop', service: 'api', id: 'abc' })).toBe('shop--api--share-abc')
  })

  it('validates and bounds the entire hostname', () => {
    const domain = [63, 63, 63, 54].map((length) => 'x'.repeat(length)).join('.')
    expect(hostnameFor({ project: 'p', service: 'api' }, domain)).toHaveLength(253)
    expect(() => hostnameFor({ project: 'p', service: 'api' }, `${domain}x`)).toThrow('253')
    expect(() => hostnameFor({ project: 'p', service: 'api' }, '-invalid.example')).toThrow('domain')
    expect(hostnameFor({ project: 'shop', service: 'api' }, 'DEV.EXAMPLE.COM.')).toBe('shop--api.dev.example.com')
  })
})

describe('the digest', () => {
  it('is stable and distinguishes inputs', () => {
    expect(shortHash('a')).toBe('ca978112')
    expect(shortHash('a')).toBe(shortHash('a'))
    expect(shortHash('a')).not.toBe(shortHash('b'))
  })
})
