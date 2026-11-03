import { describe, expect, it } from 'vitest'
import { renderAuthDynamic } from './dynamic.ts'
import { emptyProtectionStore, setDefaultCrawlers, setEnvironmentCrawlers, setProtection } from './protections.ts'

describe('ForwardAuth dynamic file', () => {
  it('renders a shared middleware and one unprotected reserved-path router per protection', () => {
    const store = setProtection(emptyProtectionStore(), {
      scope: 'share:a7f3',
      host: 'demo.example.com',
      entryPoints: ['websecure'],
      mode: 'protected',
      user: 'reviewer',
      hash: '$portta$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      label: 'Demo',
    })
    const yaml = renderAuthDynamic(store)
    expect(yaml).toContain('portta-forward-auth:')
    expect(yaml).toContain('address: "http://portta-auth:4180/verify"')
    expect(yaml).toContain('Host(`demo.example.com`) && PathPrefix(`/__portta/auth`)')
    expect(yaml).toContain('priority: 10000')
    const router = yaml.slice(yaml.indexOf('portta-auth-login-share-a7f3:'), yaml.indexOf('    portta-auth-robots-'))
    expect(router).not.toContain('middlewares:')
  })

  it('gives long hosts that share a prefix their own login router', () => {
    const base = 'ceaf-mppa-reformulacao-01-upgrade-laravel-13'
    let store = emptyProtectionStore()
    for (const service of ['app', 'ldap-test']) {
      store = setProtection(store, {
        scope: `host:${base}-${service}.example.com`,
        host: `${base}-${service}.example.com`,
        entryPoints: ['websecure'],
        mode: 'protected',
        user: 'reviewer',
        hash: '$portta$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        label: service,
      })
    }
    const names = [...renderAuthDynamic(store).matchAll(/^ {4}(portta-auth-login-[^:]+):$/gm)].map((m) => m[1] ?? '')
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    expect(names.every((name) => name.length <= 80)).toBe(true)
  })

  it('renders no login router for a public host', () => {
    const store = setProtection(emptyProtectionStore(), {
      scope: 'host:api.example.com',
      host: 'api.example.com',
      entryPoints: ['websecure'],
      mode: 'public',
      label: 'api',
    })
    const yaml = renderAuthDynamic(store)
    expect(yaml).not.toContain('PathPrefix(`/__portta/auth`)')
    expect(yaml).toContain('portta-forward-auth:')
  })

  // The panel is not behind this middleware any more: it signs people in
  // itself. A `scope=panel` address here would send its requests through a
  // second opinion that decides nothing.
  it('declares one middleware, for projects and shares, and never the panel', () => {
    const yaml = renderAuthDynamic(emptyProtectionStore())
    expect(yaml).not.toContain('scope=panel')
    expect(yaml).not.toContain('portta-web-auth')
    expect(yaml).not.toContain('users:')
  })

  // The header list is what the ForwardAuth response is allowed to set on the
  // request behind it. Anything left in it that nothing writes is an opening.
  it('forwards attribution and nothing that decides a permission', () => {
    const yaml = renderAuthDynamic(emptyProtectionStore())
    expect(yaml).toContain('authResponseHeaders: [X-Forwarded-User, X-Portta-Actor, X-Portta-Actor-Kind]')
  })

  describe('robots.txt', () => {
    const base = {
      entryPoints: ['websecure'],
      mode: 'public' as const,
      label: 'api',
    }

    it('answers /robots.txt on a host that keeps crawlers out, which is every host by default', () => {
      const store = setProtection(emptyProtectionStore(), {
        ...base,
        scope: 'host:a.example.com',
        host: 'a.example.com',
      })
      const yaml = renderAuthDynamic(store)
      expect(yaml).toContain('Host(`a.example.com`) && Path(`/robots.txt`)')
      expect(yaml).toContain('path: "/__portta/auth/robots.txt"')
    })

    it('leaves the application its own robots.txt on a host that lets every crawler in', () => {
      const open = { search: true, train: true, live: true, preview: true }
      let store = setProtection(emptyProtectionStore(), { ...base, scope: 'host:a.example.com', host: 'a.example.com' })
      store = setDefaultCrawlers(store, open)
      expect(renderAuthDynamic(store)).not.toContain('Path(`/robots.txt`)')
    })

    it('follows an environment exception over the default', () => {
      const open = { search: true, train: true, live: true, preview: true }
      let store = setProtection(emptyProtectionStore(), {
        ...base,
        scope: 'host:a.example.com',
        host: 'a.example.com',
        project: 'demo-a',
      })
      store = setEnvironmentCrawlers(store, ['demo-a'], open)
      expect(renderAuthDynamic(store)).not.toContain('Path(`/robots.txt`)')
      expect(renderAuthDynamic(setEnvironmentCrawlers(store, ['demo-a'], null))).toContain('Path(`/robots.txt`)')
    })
  })
})
