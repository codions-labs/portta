import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { BRIDGE_IMAGE, composeFiles, loadGatewayConfig } from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreconditionError, RefusedError } from '../errors.js'

const mocks = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    // The source tests have no bundled cli.js; supply only that package artifact.
    copyFileSync: ((source, destination, mode) => {
      if (String(source).endsWith('/commands/cli.js') && !actual.existsSync(source)) {
        actual.writeFileSync(destination, '#!/usr/bin/env node\n')
      } else actual.copyFileSync(source, destination, mode)
    }) satisfies typeof actual.copyFileSync,
  }
})

import { refreshRuntimeCache, setupCommand } from './setup.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.runProcess.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  delete process.env.PORTTA_RUNTIME_ROOT
})

function command(options: Record<string, unknown>): Command {
  return { optsWithGlobals: () => options } as unknown as Command
}

function hostChecks(bridgeCached = true): void {
  let cached = bridgeCached
  mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
    const value = args.join(' ')
    if (value.startsWith('version --format')) return { stdout: '28.5.1', stderr: '', exitCode: 0, failed: false }
    if (value === 'compose version --short') return { stdout: '2.40.0', stderr: '', exitCode: 0, failed: false }
    if (value === `image inspect ${BRIDGE_IMAGE}`)
      return { stdout: '', stderr: cached ? '' : 'No such image', exitCode: cached ? 0 : 1, failed: !cached }
    if (value === `pull ${BRIDGE_IMAGE}`) cached = true
    if (args[0] === 'compose' && args.includes('ps'))
      return { stdout: 'gateway\n', stderr: '', exitCode: 0, failed: false }
    return { stdout: '', stderr: '', exitCode: 0, failed: false }
  })
}

describe('setup', () => {
  function panelInstallation(): string {
    const root = mkdtempSync(join(tmpdir(), 'portta-setup-'))
    roots.push(root)
    const runtime = join(root, 'runtime')
    mkdirSync(join(runtime, 'config/traefik/dynamic'), { recursive: true })
    writeFileSync(join(runtime, 'VERSION'), '0.8.0\n')
    const env = { PORTTA_PROFILE: 'local', PORTTA_WEB: 'true', PORTTA_WEB_EXPOSE: 'local' }
    writeFileSync(
      join(runtime, '.env.example'),
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    )
    for (const file of composeFiles(loadGatewayConfig(env))) {
      mkdirSync(dirname(join(runtime, file)), { recursive: true })
      writeFileSync(join(runtime, file), 'services: {}\n')
    }
    process.env.PORTTA_RUNTIME_ROOT = runtime
    return join(root, 'gateway')
  }

  it('prints an idempotent dry-run plan without touching the target', async () => {
    hostChecks()
    const root = mkdtempSync(join(tmpdir(), 'portta-setup-'))
    roots.push(root)
    const runtime = join(root, 'runtime')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'VERSION'), '0.8.0\n')
    process.env.PORTTA_RUNTIME_ROOT = runtime
    const target = join(root, 'gateway')
    let stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })

    await setupCommand({ dir: target, dryRun: true }, command({ json: true }))

    expect(existsSync(target)).toBe(false)
    expect(JSON.parse(stdout).data).toMatchObject({ dryRun: true, target })
    expect(mocks.runProcess).toHaveBeenCalledTimes(3)
  })

  it('refuses an existing unrelated directory without overwriting it', async () => {
    hostChecks()
    const root = mkdtempSync(join(tmpdir(), 'portta-setup-'))
    roots.push(root)
    const runtime = join(root, 'runtime')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'VERSION'), '0.8.0\n')
    process.env.PORTTA_RUNTIME_ROOT = runtime
    const target = join(root, 'gateway')
    mkdirSync(target)
    const marker = join(target, 'keep.txt')
    writeFileSync(marker, 'mine\n')

    await expect(setupCommand({ dir: target }, command({ yes: true, quiet: true }))).rejects.toBeInstanceOf(
      RefusedError,
    )
    expect(readFileSync(marker, 'utf8')).toBe('mine\n')
    expect(mocks.runProcess).toHaveBeenCalledTimes(3)
  })

  it('prepares the missing bridge image before starting an enabled panel', async () => {
    hostChecks(false)
    await setupCommand({ dir: panelInstallation() }, command({ yes: true, quiet: true }))
    const commands = mocks.runProcess.mock.calls.map(([, args]) => args as string[])
    const bridgePull = commands.findIndex((args) => args[0] === 'pull' && args[1] === BRIDGE_IMAGE)
    const convergence = commands.findIndex((args) => args[0] === 'compose' && args.includes('up'))
    expect(bridgePull).toBeGreaterThanOrEqual(0)
    expect(convergence).toBeGreaterThan(bridgePull)
  })

  it('refuses --skip-pull before starting an enabled panel with no cached bridge', async () => {
    hostChecks(false)
    await expect(
      setupCommand({ dir: panelInstallation(), skipPull: true }, command({ yes: true, quiet: true })),
    ).rejects.toBeInstanceOf(PreconditionError)
    const commands = mocks.runProcess.mock.calls.map(([, args]) => args as string[])
    expect(commands.some((args) => args.includes('pull'))).toBe(false)
    expect(commands.some((args) => args[0] === 'compose' && args.includes('up'))).toBe(false)
  })

  it('starts with --skip-pull when the enabled panel bridge is already cached', async () => {
    hostChecks()
    await setupCommand({ dir: panelInstallation(), skipPull: true }, command({ yes: true, quiet: true }))
    const commands = mocks.runProcess.mock.calls.map(([, args]) => args as string[])
    expect(commands.some((args) => args.includes('pull'))).toBe(false)
    expect(commands.some((args) => args[0] === 'compose' && args.includes('up'))).toBe(true)
  })
})

describe('updating the runtime copy', () => {
  function packaged(version: string) {
    const root = mkdtempSync(join(tmpdir(), 'portta-package-'))
    roots.push(root)
    mkdirSync(join(root, 'config', 'traefik', 'dynamic'), { recursive: true })
    mkdirSync(join(root, 'docker'))
    writeFileSync(join(root, 'VERSION'), `${version}\n`)
    writeFileSync(join(root, 'docker', 'compose.yaml'), `# ${version}\n`)
    return root
  }

  it('keeps the plans and overlays that adopted projects name, and replaces the rest', () => {
    const target = mkdtempSync(join(tmpdir(), 'portta-install-'))
    roots.push(target)
    refreshRuntimeCache(packaged('0.8.0'), target)
    const adopted = join(target, 'runtime', 'compose', '224fc8d77666a605')
    mkdirSync(adopted, { recursive: true })
    writeFileSync(join(adopted, 'compose.portta.yaml'), 'services: {}\n')
    writeFileSync(join(adopted, 'plan.json'), '{}\n')
    writeFileSync(join(target, 'runtime', 'old-asset.txt'), 'from an older package\n')

    refreshRuntimeCache(packaged('0.9.0'), target)

    expect(readFileSync(join(adopted, 'compose.portta.yaml'), 'utf8')).toBe('services: {}\n')
    expect(existsSync(join(adopted, 'plan.json'))).toBe(true)
    expect(readFileSync(join(target, 'runtime', 'VERSION'), 'utf8')).toBe('0.9.0\n')
    expect(existsSync(join(target, 'runtime', 'old-asset.txt'))).toBe(false)
    expect(readFileSync(join(target, 'runtime', 'docker', 'compose.yaml'), 'utf8')).toBe('# 0.9.0\n')
  })
})
