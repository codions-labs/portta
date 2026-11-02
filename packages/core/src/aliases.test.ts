import { describe, expect, it } from 'vitest'
import { parseAliases, renderAliases, renderAliasesForStore, type StoredAlias } from './aliases.ts'
import { emptyProtectionStore, setProtection } from './protections.ts'

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

  it('keeps an alias suspended until the conflicting decision has been removed', () => {
    const previous = setProtection(emptyProtectionStore(), {
      host: ALIAS.host,
      scope: 'host:store',
      mode: 'public',
      label: 'new owner',
      project: 'other',
      service: 'web',
      entryPoints: ['websecure'],
    })
    const pending = renderAliasesForStore([ALIAS], emptyProtectionStore(), true, previous)
    expect(pending).not.toContain('Host(`store.example.test`)')
    expect(parseAliases(pending)).toEqual([ALIAS])
    expect(renderAliasesForStore([ALIAS], emptyProtectionStore(), true)).toContain('Host(`store.example.test`)')
  })
})
