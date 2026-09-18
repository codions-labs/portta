import { describe, expect, it } from 'vitest'
import {
  panelAccessKind,
  panelAccessUpdates,
  panelHostnameKind,
  panelPreviewUrl,
  panelSubdomain,
  privateAccessKind,
  privateAccessUpdates,
} from '@/components/settings/access'
import { isFieldVisible } from '@/components/settings/visibility'

describe('panel access mapping', () => {
  it('keeps this machine as loopback', () => {
    expect(panelAccessKind('local')).toBe('local')
    expect(
      panelPreviewUrl({
        expose: 'local',
        port: '8081',
        bind: '127.0.0.1',
        subdomain: 'portta',
        advertised: '',
        base: 'localhost',
        tls: false,
      }),
    ).toBe('http://127.0.0.1:8081')
    expect(
      panelPreviewUrl({
        expose: 'local',
        port: '8081',
        bind: '::1',
        subdomain: 'portta-web',
        advertised: '',
        base: 'localhost',
        tls: false,
      }),
    ).toBe('http://[::1]:8081')
    const updates = panelAccessUpdates({
      kind: 'local',
      hostnameKind: 'subdomain',
      subdomain: 'portta-web',
      advertisedHost: '',
      port: '8081',
      bind: '0.0.0.0',
      base: 'localhost',
      tls: false,
    })
    expect(updates.PORTTA_WEB_BIND_ADDRESS).toBe('127.0.0.1')
  })

  it('writes a subdomain of the configured domain without publishing projects', () => {
    const updates = panelAccessUpdates({
      kind: 'hostname',
      hostnameKind: 'subdomain',
      subdomain: 'portta',
      advertisedHost: '',
      port: '8081',
      bind: '127.0.0.1',
      base: 'localhost',
      tls: false,
    })
    expect(updates.PORTTA_WEB_EXPOSE).toBe('vpn')
    expect(updates.PORTTA_WEB_HOST).toBe('portta')
    expect(updates.PORTTA_PANEL_ADVERTISED_HOST).toBe('portta.localhost')
    expect(updates.PORTTA_PANEL_URL).toBe('http://portta.localhost')
    expect(updates.PORTTA_AUTH_MODE).toBe('required')
    expect(updates.PUBLIC_ENABLED).toBeUndefined()
  })

  it('uses domain + https when TLS is on', () => {
    const updates = panelAccessUpdates({
      kind: 'hostname',
      hostnameKind: 'custom',
      subdomain: 'portta',
      advertisedHost: 'portta.example.com',
      port: '8081',
      bind: '127.0.0.1',
      base: 'dev.example.com',
      tls: true,
    })
    expect(updates.PORTTA_WEB_EXPOSE).toBe('domain')
    expect(updates.PORTTA_PANEL_ADVERTISED_HOST).toBe('portta.example.com')
    expect(updates.PORTTA_PANEL_URL).toBe('https://portta.example.com')
    expect(updates.PORTTA_WEB_BIND_ADDRESS).toBe('127.0.0.1')
  })

  it('uses the dedicated public entrypoint without publishing projects', () => {
    const updates = panelAccessUpdates({
      kind: 'public',
      hostnameKind: 'custom',
      subdomain: 'portta-web',
      advertisedHost: '203.0.113.10',
      port: '8081',
      bind: '127.0.0.1',
      base: 'localhost',
      tls: false,
    })
    expect(updates.PORTTA_WEB_EXPOSE).toBe('public')
    expect(updates.PORTTA_WEB_BIND_ADDRESS).toBe('0.0.0.0')
    expect(updates.PORTTA_PANEL_ADVERTISED_HOST).toBe('203.0.113.10')
    expect(updates.PORTTA_PANEL_URL).toBe('http://203.0.113.10:8081')
    expect(updates.PUBLIC_ENABLED).toBeUndefined()
    expect(
      panelPreviewUrl({
        expose: 'public',
        port: '8081',
        bind: '0.0.0.0',
        subdomain: 'portta-web',
        advertised: '203.0.113.10',
        base: 'localhost',
        tls: false,
      }),
    ).toBe('http://203.0.113.10:8081')
  })

  it('reads a vpn host back as a subdomain', () => {
    expect(panelHostnameKind('vpn', 'portta.localhost', 'portta', 'localhost')).toBe('subdomain')
    expect(panelHostnameKind('domain', 'portta.example.com', 'portta', 'localhost')).toBe('custom')
    expect(panelSubdomain('domain', 'admin.example.com', 'portta-web', 'example.com')).toBe('admin')
    expect(
      panelHostnameKind(
        'domain',
        'admin.example.com',
        panelSubdomain('domain', 'admin.example.com', 'portta-web', 'example.com'),
        'example.com',
      ),
    ).toBe('subdomain')
    expect(panelSubdomain('domain', 'admin.ops.example.com', 'portta-web', 'example.com')).toBe('portta-web')
    expect(panelHostnameKind('domain', 'admin.ops.example.com', 'portta-web', 'example.com')).toBe('custom')
  })
})

describe('private project access mapping', () => {
  it('preserves a host-native VPN instead of silently enabling the Tailscale container', () => {
    const values = { TAILSCALE_ENABLED: 'false', PORTTA_BIND_ADDRESS: '100.64.0.12' }
    expect(privateAccessKind(values)).toBe('interface')
    expect(privateAccessUpdates('interface', values.PORTTA_BIND_ADDRESS)).toEqual(
      expect.objectContaining({
        PORTTA_PROFILE: 'remote-private',
        PORTTA_BIND_ADDRESS: '100.64.0.12',
        TAILSCALE_ENABLED: 'false',
      }),
    )
  })

  it('keeps the managed Tailscale path on loopback', () => {
    expect(privateAccessUpdates('tailscale')).toEqual(
      expect.objectContaining({
        PORTTA_BIND_ADDRESS: '127.0.0.1',
        TAILSCALE_ENABLED: 'true',
      }),
    )
  })
})

describe('conditional fields', () => {
  it('hides automatic-only fields on localhost', () => {
    const values = { PORTTA_DOMAIN_MODE: 'local', PUBLIC_ENABLED: 'false', TLS_ENABLED: 'false' }
    expect(isFieldVisible('PORTTA_PUBLIC_IP', values)).toBe(false)
    expect(isFieldVisible('PORTTA_DOMAIN', values)).toBe(false)
    expect(isFieldVisible('PUBLIC_DOMAIN', values)).toBe(false)
    expect(isFieldVisible('ACME_EMAIL', values)).toBe(false)
  })

  it('shows the public domain only when internet access is on', () => {
    expect(isFieldVisible('PUBLIC_DOMAIN', { PUBLIC_ENABLED: 'true' })).toBe(true)
    expect(isFieldVisible('PORTTA_WEB_HOST', { PORTTA_WEB_EXPOSE: 'vpn' })).toBe(false)
  })
})
