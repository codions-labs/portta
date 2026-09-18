import { describe, expect, it } from 'vitest'
import { AUTH_BUILD_FILE, AUTH_DEV_FILE, composeFiles, loadGatewayConfig, PANEL_HOST_FILE } from './config.js'

describe('gateway configuration', () => {
  it('owns the safe local defaults shared by panel and CLI', () => {
    const config = loadGatewayConfig({})
    expect(config).toMatchObject({
      profile: 'local',
      domain: 'localhost',
      bindAddress: '127.0.0.1',
      publicEnabled: false,
      webEnabled: false,
    })
    expect(composeFiles(config)).toEqual([
      'docker/compose/compose.yaml',
      'docker/compose/attach/host.yaml',
      'docker/compose/profiles/local.yaml',
    ])
  })

  it('selects the web development overlay once', () => {
    const config = loadGatewayConfig({ PORTTA_WEB: 'true', PORTTA_WEB_DEV: 'true' })
    expect(composeFiles(config)).toEqual([
      'docker/compose/compose.yaml',
      'docker/compose/attach/host.yaml',
      'docker/compose/profiles/local.yaml',
      'docker/compose/features/web.yaml',
      'docker/compose/features/web-bind.yaml',
      'docker/compose/features/web-dev.yaml',
      PANEL_HOST_FILE,
      AUTH_DEV_FILE,
    ])
  })

  // The panel reads issues through the daemon, so the connection comes with
  // having a panel; Taskflow's routes ride on the same connection.
  it('connects the panel to the host daemon whenever the panel is on', () => {
    expect(composeFiles(loadGatewayConfig({}))).not.toContain(PANEL_HOST_FILE)
    expect(composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true' }))).toContain(PANEL_HOST_FILE)
  })

  it('refuses a public profile with no public domain', () => {
    expect(() => loadGatewayConfig({ PORTTA_PROFILE: 'remote-public' })).toThrow('PUBLIC_DOMAIN')
  })

  // Exactly one overlay owns the panel's front door, or two of them would
  // claim PORTTA_WEB_PORT and one would bypass the credential.
  it('a public panel is published by Traefik, not by the container', () => {
    const files = composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true', PORTTA_WEB_EXPOSE: 'public' }))
    expect(files).toContain('docker/compose/features/panel-public.yaml')
    expect(files).not.toContain('docker/compose/features/web-bind.yaml')
  })

  it('every other access mode publishes the container', () => {
    for (const mode of ['local', 'tailscale', 'vpn']) {
      const files = composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true', PORTTA_WEB_EXPOSE: mode }))
      expect(files).toContain('docker/compose/features/web-bind.yaml')
      expect(files).not.toContain('docker/compose/features/panel-public.yaml')
    }
  })

  it('keeps the dashboard on loopback', () => {
    const files = composeFiles(loadGatewayConfig({ PORTTA_DASHBOARD: 'true' }))
    expect(files).toContain('docker/compose/features/dashboard.yaml')
  })

  it('rejects an unknown access mode instead of guessing', () => {
    expect(() => loadGatewayConfig({ PORTTA_WEB_EXPOSE: 'everywhere' })).toThrow('panel access mode')
  })

  it('a normal installation never selects the build overlay', () => {
    expect(composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true' }))).not.toContain(
      'docker/compose/features/web-build.yaml',
    )
    expect(composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true' }))).not.toContain(AUTH_BUILD_FILE)
    expect(composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true', PORTTA_WEB_BUILD: 'true' }))).toContain(
      'docker/compose/features/web-build.yaml',
    )
    expect(composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true', PORTTA_WEB_BUILD: 'true' }))).toContain(AUTH_BUILD_FILE)
  })

  it('a local build is selected by its flags, never by where the files are', () => {
    const files = composeFiles(loadGatewayConfig({ CLOUDFLARE_TUNNEL_ENABLED: 'true' }))
    expect(files).not.toContain(AUTH_BUILD_FILE)
    expect(files).not.toContain(AUTH_DEV_FILE)
    expect(files).toContain('docker/compose/features/cloudflare-tunnel.yaml')
  })
})
