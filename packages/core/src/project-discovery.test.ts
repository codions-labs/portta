import { describe, expect, it } from 'vitest'
import { adoptCommand } from './project-discovery.js'

describe('the reviewed adoption command', () => {
  it('preserves callers without a chosen namespace', () => {
    expect(adoptCommand('shop', { web: 'protect' }, '/srv/projects')).toBe(
      'portta adopt /srv/projects/shop --protect web',
    )
  })

  it('binds the reviewed namespace and quotes shell metacharacters literally', () => {
    expect(adoptCommand('shop', { web: 'public' }, '/srv/projects', 'shop name;$(id)')).toBe(
      "portta adopt /srv/projects/shop --project 'shop name;$(id)' --public web",
    )
  })
})
