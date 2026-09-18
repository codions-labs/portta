import { describe, expect, it } from 'vitest'
import { renderShares } from './share.js'

const shares = [
  {
    id: 'a7f3',
    project: 'storefront',
    service: 'web',
    container: 'storefront-web-1',
    port: 3000,
    host: 'storefront-web-a7f3.share.dev.example.com',
    mode: 'protected' as const,
    user: 'reviewer',
    entryPoint: 'websecure',
    createdAt: 1,
    expiresAt: 2,
  },
]

describe('share rendering', () => {
  it('routes an additional hostname without touching the project router', () => {
    const rendered = renderShares(shares)
    expect(rendered).toContain('url: "http://storefront-web-1:3000"')
    expect(rendered).toContain('middlewares: [portta-forward-auth]')
    expect(rendered).not.toContain('traefik.http.routers')
  })
  it('renders an empty document without an invalid http key', () => {
    const rendered = renderShares([])
    expect(rendered).toContain('not a deny rule')
    expect(rendered).not.toMatch(/^http:/m)
  })
})
