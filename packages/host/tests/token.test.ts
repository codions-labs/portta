import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostStateDir, resolveHostStateDir } from '../src/token.ts'

describe('the host state directory', () => {
  it('is state/host under the installation by default', () => {
    expect(resolveHostStateDir('/opt/portta', {})).toBe(join('/opt/portta', 'state', 'host'))
    expect(resolveHostStateDir('/opt/portta', {})).toBe(hostStateDir('/opt/portta'))
  })

  // `portta host serve` and `portta flow` must agree on where the token is, or
  // every flow command is refused by the daemon it just started.
  it('follows PORTTA_HOST_STATE_DIR when it is set', () => {
    expect(resolveHostStateDir('/opt/portta', { PORTTA_HOST_STATE_DIR: '/tmp/state' })).toBe('/tmp/state')
    expect(resolveHostStateDir('/opt/portta', { PORTTA_HOST_STATE_DIR: '  ' })).toBe(hostStateDir('/opt/portta'))
  })
})
