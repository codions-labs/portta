import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RefusedError } from '../errors.js'

const mocks = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))

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

function hostChecks(): void {
  mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
    const value = args.join(' ')
    if (value.startsWith('version --format')) return { stdout: '28.5.1', stderr: '', exitCode: 0, failed: false }
    if (value === 'compose version --short') return { stdout: '2.40.0', stderr: '', exitCode: 0, failed: false }
    return { stdout: '', stderr: '', exitCode: 0, failed: false }
  })
}

describe('setup', () => {
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
