import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findGatewayRoot, gatewayContext, versionForRoot } from './context.js'
import { CLI_VERSION } from './version.js'

/**
 * An installed gateway carries a generated VERSION plus the compose files the
 * resolved configuration names, so the fixture writes exactly those.
 */
function fixture(env: string): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-context-'))
  mkdirSync(join(root, 'docker/compose/attach'), { recursive: true })
  mkdirSync(join(root, 'docker/compose/profiles'), { recursive: true })
  mkdirSync(join(root, 'docker/compose/features'), { recursive: true })
  writeFileSync(join(root, 'VERSION'), '0.2.0\n')
  for (const file of [
    'compose.yaml',
    'attach/host.yaml',
    'attach/tailscale.yaml',
    'profiles/local.yaml',
    'profiles/remote.yaml',
    'profiles/public.yaml',
    'features/web.yaml',
    'features/panel-host.yaml',
    'features/web-bind.yaml',
    'features/web-dev.yaml',
    'features/web-build.yaml',
    'features/auth-build.yaml',
    'features/auth-dev.yaml',
  ]) {
    writeFileSync(join(root, 'docker/compose', file), '{}\n')
  }
  writeFileSync(join(root, '.env'), env)
  return root
}

describe('installation values win over inherited environment', () => {
  let root: string
  const saved = process.env.PORTTA_WEB

  beforeEach(() => {
    root = fixture('PORTTA_WEB=true\n')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) delete process.env.PORTTA_WEB
    else process.env.PORTTA_WEB = saved
  })

  it('an inherited value cannot override persisted installation configuration', () => {
    process.env.PORTTA_WEB = 'false'
    expect(gatewayContext({ root }).config.webEnabled).toBe(true)
  })

  // The regression: `web up` wrote PORTTA_WEB=true, re-resolved, and read the
  // inherited false back. Compose was then handed a file list without the
  // panel overlays and asked to start `web`, which answered "no such service".
  it('but a value just written wins, or the overlays it selects go missing', () => {
    process.env.PORTTA_WEB = 'false'
    const context = gatewayContext({ root, overrides: { PORTTA_WEB: 'true' } })
    expect(context.config.webEnabled).toBe(true)
    expect(context.composeFiles).toContain('docker/compose/features/web.yaml')
  })
})

describe('the resolved values reach Compose', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // Traefik bakes PORTTA_DOMAIN into its default rule and publishes
  // PORTTA_BIND_ADDRESS. Both are derived, so handing Compose the raw .env
  // values starts a gateway that disagrees with every command describing it.
  it('the derived domain replaces the stored one', () => {
    root = fixture('PORTTA_DOMAIN_MODE=auto\nPORTTA_PUBLIC_IP=203.0.113.10\nPORTTA_DOMAIN=localhost\n')
    const context = gatewayContext({ root })
    expect(context.config.domain).toBe('203-0-113-10.sslip.io')
    expect(context.env.PORTTA_DOMAIN).toBe('203-0-113-10.sslip.io')
  })

  it('and the public profile really binds every interface', () => {
    root = fixture('PORTTA_PROFILE=remote-public\nPUBLIC_DOMAIN=dev.example.test\nPORTTA_BIND_ADDRESS=127.0.0.1\n')
    const context = gatewayContext({ root })
    expect(context.config.bindAddress).toBe('0.0.0.0')
    expect(context.env.PORTTA_BIND_ADDRESS).toBe('0.0.0.0')
  })

  it('uses a fixed local identity for a checkout without a generated VERSION', () => {
    root = fixture('')
    rmSync(join(root, 'VERSION'))
    mkdirSync(join(root, 'packages/cli'), { recursive: true })
    writeFileSync(join(root, 'packages/cli/package.json'), '{"version":"9.9.9"}\n')
    expect(gatewayContext({ root }).version).toBe('0.0.0-local')
  })
})

describe('finding an installation from anywhere', () => {
  const saved = {
    HOME: process.env.HOME,
    PORTTA_HOME: process.env.PORTTA_HOME,
    PORTTA_ROOT: process.env.PORTTA_ROOT,
  }
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'portta-home-'))
    process.env.HOME = home
    delete process.env.PORTTA_HOME
    delete process.env.PORTTA_ROOT
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  // `portta setup` installs into ~/portta unless told otherwise, so a command
  // run from any other directory has to find that installation on its own.
  it('finds the default setup target under the home directory', () => {
    const installed = fixture('')
    const target = join(home, 'portta')
    mkdirSync(home, { recursive: true })
    rmSync(target, { recursive: true, force: true })
    mkdirSync(join(target, 'docker/compose'), { recursive: true })
    writeFileSync(join(target, 'VERSION'), '0.2.0\n')
    writeFileSync(join(target, 'docker/compose/compose.yaml'), '{}\n')
    rmSync(installed, { recursive: true, force: true })
    const elsewhere = mkdtempSync(join(home, 'elsewhere-'))
    expect(findGatewayRoot(elsewhere)).toBe(target)
  })

  it('lets PORTTA_HOME name the installation first', () => {
    const named = join(home, 'named')
    mkdirSync(join(named, 'docker/compose'), { recursive: true })
    writeFileSync(join(named, 'VERSION'), '0.2.0\n')
    writeFileSync(join(named, 'docker/compose/compose.yaml'), '{}\n')
    process.env.PORTTA_HOME = named
    const elsewhere = mkdtempSync(join(home, 'elsewhere-'))
    expect(findGatewayRoot(elsewhere)).toBe(named)
  })
})

describe('this checkout', () => {
  // A release number committed to the CLI manifest leaks into local builds and
  // makes a checkout's CLI disagree with its own gateway. CI rewrites both
  // together (tooling/prepare-publication.mjs), so they still agree there.
  it('builds the CLI under the same version as its gateway', () => {
    expect(CLI_VERSION).toBe(versionForRoot(resolve(import.meta.dirname, '../../..')))
  })
})
