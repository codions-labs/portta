// The applier's refusals. The panel now reports these back to the operator
// (apps/web/src/server/core/apply.ts), so the codes and wording are contract,
// not just a warning printed on a terminal. See ADR 0026.
import { describe, expect, it } from 'vitest'
import { applyCreateArguments, applyRefusal, applySpec } from './apply.ts'
import { porttaImages } from './images.ts'

describe('applyRefusal', () => {
  it('serves a plain local host', () => {
    expect(applyRefusal({ PORTTA_PROFILE: 'local' })).toBeNull()
  })

  it('refuses a publicly exposed panel', () => {
    expect(applyRefusal({ PORTTA_WEB_EXPOSE: 'public' })).toContain('apply on the host instead')
  })

  it('refuses the remote-public profile', () => {
    expect(applyRefusal({ PORTTA_PROFILE: 'remote-public' })).toContain('on the host only')
  })
})

describe('the container it would create', () => {
  const args = applyCreateArguments('/opt/portta', applySpec('/opt/portta', '0.3.0'), '0.3.0')

  it('takes no network, so it cannot be a pivot', () => {
    expect(args).toContain('--network')
    expect(args[args.indexOf('--network') + 1]).toBe('none')
  })

  it('fixes its command at creation, with no profile baked in', () => {
    expect(args.slice(-3)).toEqual(['node', '/opt/portta/bin/portta', 'up'])
  })

  // The spec label makes `up` replace an applier whose image no longer matches.
  it('records the image in its spec, so a new image supersedes the old', () => {
    expect(applySpec('/opt/portta', '0.3.0')).toContain(porttaImages('0.3.0').apply)
  })
})
