import { describe, expect, it } from 'vitest'
import { assertRemovableWorkingDir, PathRefused } from './paths.ts'

describe('assertRemovableWorkingDir', () => {
  it('accepts a normal project checkout', () => {
    expect(assertRemovableWorkingDir('/srv/dev/alpha')).toBe('/srv/dev/alpha')
    expect(assertRemovableWorkingDir('/srv/people/dev/storefront')).toBe('/srv/people/dev/storefront')
  })

  it('rejects a relative path', () => {
    expect(() => assertRemovableWorkingDir('srv/dev/alpha')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('alpha')).toThrow(PathRefused)
  })

  it('rejects traversal', () => {
    expect(() => assertRemovableWorkingDir('/srv/dev/../etc')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv/dev/alpha/../../etc')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv/dev/foo/..')).toThrow(PathRefused)
  })

  it('rejects the filesystem root and a top-level directory', () => {
    expect(() => assertRemovableWorkingDir('/')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/home')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv')).toThrow(PathRefused)
  })

  it('rejects an empty or NUL path', () => {
    expect(() => assertRemovableWorkingDir('')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv/dev/alpha\0/etc')).toThrow(PathRefused)
  })
})
