import { describe, expect, it } from 'vitest'
import { renderAuthDynamic } from './dynamic.ts'
import { emptyProtectionStore, setProtection } from './protections.ts'

describe('ForwardAuth dynamic file', () => {
  it('renders a shared middleware and one unprotected reserved-path router per protection', () => {
    const store = setProtection(emptyProtectionStore(), {
      scope: 'share:a7f3',
      host: 'demo.example.com',
      entryPoints: ['websecure'],
      user: 'reviewer',
      hash: '$portta$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      label: 'Demo',
    })
    const yaml = renderAuthDynamic(store)
    expect(yaml).toContain('portta-forward-auth:')
    expect(yaml).toContain('address: "http://portta-auth:4180/verify"')
    expect(yaml).toContain('Host(`demo.example.com`) && PathPrefix(`/__portta/auth`)')
    expect(yaml).toContain('priority: 10000')
    const router = yaml.slice(yaml.indexOf('portta-auth-login-share-a7f3:'), yaml.indexOf('  services:'))
    expect(router).not.toContain('middlewares:')
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
})
