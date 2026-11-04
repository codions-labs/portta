import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COLLECT_INTERVAL_MS } from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ collectSnapshot: vi.fn(), publishDiscovery: vi.fn() }))
vi.mock('../process.js', () => ({ spawnDetached: vi.fn() }))
vi.mock('../environment/index.js', () => ({ collectEnvironmentReport: vi.fn(async () => ({})) }))
vi.mock('../environment/store.js', () => ({ writeEnvironmentReport: vi.fn() }))
vi.mock('../environment/security/index.js', () => ({
  collectHostSecurityReport: vi.fn(async () => ({})),
  hostSecurityContext: vi.fn(() => ({})),
}))
vi.mock('../environment/security/store.js', () => ({ writeHostSecurityReport: vi.fn() }))
vi.mock('./collect.js', () => ({ collectSnapshot: mocks.collectSnapshot }))
vi.mock('./discovery.js', () => ({ publishDiscovery: mocks.publishDiscovery }))
vi.mock('./store.js', () => ({
  appendHistory: vi.fn(),
  appendLog: vi.fn(),
  writeAtomic: vi.fn(),
  writeCurrent: vi.fn(),
}))

import { runCollectorLoop } from './lifecycle.ts'

const roots: string[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('the collector loop', () => {
  it('keeps the host metrics going while a discovery is slow, and starts no second one meanwhile', async () => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'portta-loop-'))
    roots.push(root)
    mocks.collectSnapshot.mockResolvedValue({})
    mocks.publishDiscovery.mockReturnValue(new Promise(() => {}))

    const loop = runCollectorLoop(root)
    await vi.advanceTimersByTimeAsync(COLLECT_INTERVAL_MS * 3 + 1)
    expect(mocks.collectSnapshot.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(mocks.publishDiscovery).toHaveBeenCalledTimes(1)

    // A stop does not wait for a discovery that never ends.
    process.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(COLLECT_INTERVAL_MS + 6_000)
    await expect(loop).resolves.toBeUndefined()
  })
})
