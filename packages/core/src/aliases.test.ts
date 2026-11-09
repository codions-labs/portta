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

  it('preserves enforcement recorded on an individual alias', () => {
    const alias = { ...ALIAS, forwardAuth: true }
    expect(renderAliases([alias])).toContain('middlewares: [portta-forward-auth]')
    expect(parseAliases(renderAliases([alias]))).toEqual([alias])
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

  it('gives every hostname of one service its own router, the first keeping its old name', () => {
    const second: StoredAlias = { ...ALIAS, host: 'www.store.example.test' }
    const rendered = renderAliases([ALIAS, second])
    expect(rendered).toContain('portta-alias-shop-web:')
    expect(rendered).toContain('portta-alias-shop-web-2:')
    expect(rendered).toContain('Host(`www.store.example.test`)')
    expect(rendered).toContain('http://shop-web-1:3000')
    expect(parseAliases(rendered)).toEqual([ALIAS, second])
  })

  it('names the ACME resolver on the router of a custom domain, and only there', () => {
    const custom: StoredAlias = { ...ALIAS, host: 'app.cliente.com.br', custom: true, certResolver: 'letsencrypthttp' }
    const rendered = renderAliases([ALIAS, custom])
    expect(rendered.match(/^ +certResolver:/gm)).toHaveLength(1)
    expect(rendered).toContain('certResolver: "letsencrypthttp"')
    expect(parseAliases(rendered)).toEqual([ALIAS, custom])
  })

  it('never gives two routers the same name, even when service names spell the suffix', () => {
    const web2: StoredAlias = { ...ALIAS, service: 'web-2', container: 'shop-web-2-1', host: 'two.example.test' }
    const second: StoredAlias = { ...ALIAS, host: 'www.store.example.test' }
    const rendered = renderAliases([web2, ALIAS, second])
    const names = [...rendered.matchAll(/^ {4}(portta-alias-[\w-]+):$/gm)].map((match) => match[1])
    const routers = names.slice(0, 3)
    expect(new Set(routers).size).toBe(3)
  })
})
