import { describe, expect, it } from 'vitest'
import { parseAliases, renderAliases, type StoredAlias } from './aliases.ts'

const ALIAS: StoredAlias = {
  project: 'shop',
  service: 'web',
  container: 'shop-web-1',
  host: 'store.example.test',
  port: 3000,
  entryPoint: 'websecure',
}

describe('hostname aliases', () => {
  it('route without ForwardAuth on a host that is not public', () => {
    expect(renderAliases([ALIAS])).not.toContain('middlewares')
  })

  it('pass through ForwardAuth on a public host, so an undecided alias is closed', () => {
    const rendered = renderAliases([ALIAS], true)
    expect(rendered).toContain('middlewares: [portta-forward-auth]')
    expect(parseAliases(rendered)).toEqual([ALIAS])
  })
})
