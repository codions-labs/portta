import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySnapshot } from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Output } from '../output.js'

const mocks = vi.hoisted(() => ({
  collectSnapshot: vi.fn(),
  collectEnvironmentReport: vi.fn(),
  collectHostSecurityReport: vi.fn(),
  hostSecurityContext: vi.fn(() => ({})),
  gatewayContext: vi.fn(),
  startCollector: vi.fn(),
}))
vi.mock('../metrics/collect.js', () => ({ collectSnapshot: mocks.collectSnapshot }))
vi.mock('../environment/index.js', () => ({ collectEnvironmentReport: mocks.collectEnvironmentReport }))
vi.mock('../environment/security/index.js', () => ({
  collectHostSecurityReport: mocks.collectHostSecurityReport,
  hostSecurityContext: mocks.hostSecurityContext,
}))
vi.mock('../context.js', () => ({ gatewayContext: mocks.gatewayContext }))
vi.mock('../metrics/lifecycle.js', async () => {
  const actual = await vi.importActual<typeof import('../metrics/lifecycle.js')>('../metrics/lifecycle.js')
  return { ...actual, startCollector: mocks.startCollector }
})

import { collectHostResources, ensureHostToken, ensureMetricsCollector } from './host.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.collectSnapshot.mockReset()
  mocks.collectEnvironmentReport.mockReset()
  mocks.collectHostSecurityReport.mockReset()
  mocks.hostSecurityContext.mockClear()
  mocks.gatewayContext.mockReset()
  mocks.startCollector.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-host-'))
  roots.push(root)
  return root
}

describe('host collection', () => {
  it('writes current metrics and the slower environment report', async () => {
    const root = tree()
    mocks.collectSnapshot.mockResolvedValue(emptySnapshot({ id: 'i', name: 'box', hostname: 'box' }, 1_700_000_000))
    mocks.collectEnvironmentReport.mockResolvedValue({
      version: 1,
      collectedAt: 1_700_000_000,
      durationMs: 12,
      checks: [],
      summary: { passed: 0, recommendations: 0, problems: 0, information: 0, ok: true },
    })
    mocks.collectHostSecurityReport.mockResolvedValue({
      version: 1,
      collectedAt: 1_700_000_000,
      durationMs: 8,
      checks: [],
      summary: { passed: 0, recommendations: 0, problems: 0, information: 0, ok: true },
    })

    const file = await collectHostResources(root)
    expect(file).toBe(join(root, 'state/metrics/current.json'))
    expect(existsSync(file)).toBe(true)
    const written = JSON.parse(readFileSync(file, 'utf8')) as { version: number; instance: { id: string } }
    expect(written.version).toBe(1)
    expect(written.instance.id).toBe('i')
    expect(JSON.parse(readFileSync(join(root, 'state/environment/report.json'), 'utf8')).durationMs).toBe(12)
    expect(JSON.parse(readFileSync(join(root, 'state/environment/security.json'), 'utf8')).durationMs).toBe(8)
  })

  it('keeps an automatic collector start non-fatal', async () => {
    mocks.gatewayContext.mockImplementation(() => {
      throw new Error('no gateway here')
    })
    let stderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk)
      return true
    })

    await expect(ensureMetricsCollector(undefined, new Output())).resolves.toBeUndefined()
    expect(stderr).toContain('warning: Host metrics collector could not start: no gateway here')
  })
})

describe('the host daemon token', () => {
  // Compose turns a bind mount of a missing file into a directory, which the
  // daemon could then never write its token into. The overlay that mounts it
  // now comes with the panel rather than with Task Flow, because the panel
  // reads issues through the daemon (ADR 0018) — so this has to hold for every
  // installation with a panel.
  it('exists before the panel overlay mounts it, whenever the panel is on', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-host-token-'))
    try {
      expect(ensureHostToken({ root, config: { webEnabled: false } })).toBeNull()
      expect(existsSync(join(root, 'state/host/token'))).toBe(false)
      const file = ensureHostToken({ root, config: { webEnabled: true } })
      expect(file).toBe(join(root, 'state/host/token'))
      expect(readFileSync(join(root, 'state/host/token'), 'utf8').trim()).not.toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
