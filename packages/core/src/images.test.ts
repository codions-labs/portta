import { describe, expect, it } from 'vitest'
import { assertReleaseVersion } from './images.ts'

describe('Portta release images', () => {
  it('refuses an empty, floating or malformed release', () => {
    for (const value of ['', 'latest', '0.8', 'v0.8.0', '0.8.0 bad']) {
      expect(() => assertReleaseVersion(value)).toThrow('invalid Portta release version')
    }
  })
})
