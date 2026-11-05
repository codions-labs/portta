import { describe, expect, it } from 'vitest'
import { relativeProjectPath } from './products.js'

describe('relativeProjectPath', () => {
  it('passes a path already relative to Projects Home as it is', () => {
    expect(relativeProjectPath('tuttoria/tuttoria', '/root/projects', '/anywhere')).toBe('tuttoria/tuttoria')
  })

  it('turns the current folder and an absolute path into one relative to Projects Home', () => {
    expect(relativeProjectPath('.', '/root/projects', '/root/projects/tuttoria/tuttoria')).toBe('tuttoria/tuttoria')
    expect(relativeProjectPath('/root/projects/sudofabio/publivor/', '/root/projects/', '/tmp')).toBe(
      'sudofabio/publivor',
    )
  })

  it('refuses a folder outside Projects Home, and one that cannot be placed', () => {
    expect(() => relativeProjectPath('/srv/billing', '/root/projects', '/tmp')).toThrow(/not under Projects Home/)
    expect(() => relativeProjectPath('/root/projects', '/root/projects', '/tmp')).toThrow(/not under Projects Home/)
    expect(() => relativeProjectPath('.', null, '/tmp')).toThrow(/not known on this host/)
  })
})
