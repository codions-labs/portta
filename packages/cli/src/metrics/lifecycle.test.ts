import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawnDetached: vi.fn() }))
vi.mock('../process.js', () => ({ spawnDetached: mocks.spawnDetached }))
vi.mock('../environment/index.js', () => ({ collectEnvironmentReport: vi.fn() }))
vi.mock('../environment/store.js', () => ({ writeEnvironmentReport: vi.fn() }))
vi.mock('../environment/security/index.js', () => ({
  collectHostSecurityReport: vi.fn(),
  hostSecurityContext: vi.fn(() => ({})),
}))
vi.mock('../environment/security/store.js', () => ({ writeHostSecurityReport: vi.fn() }))

import { collectorRunning, pidAlive, readCollectorPid, startCollector, writePid } from './lifecycle.ts'

const roots: string[] = []
afterEach(() => {
  mocks.spawnDetached.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-collector-'))
  roots.push(root)
  return root
}

describe('collector lifecycle', () => {
  it('treats a dead pid file as stopped', () => {
    const root = tree()
    writePid(root, 999_999_999)
    expect(pidAlive(999_999_999)).toBe(false)
    expect(collectorRunning(root)).toBeNull()
    expect(readCollectorPid(root)).toBeNull()
  })

  it('does not start a second collector when one is already running', () => {
    const root = tree()
    const running = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', 'host', 'watch'], {
      stdio: 'ignore',
    })
    if (!running.pid) throw new Error('the collector fixture did not start')
    try {
      writePid(root, running.pid)
      mocks.spawnDetached.mockReturnValue(123)
      const result = startCollector(root)
      expect(result).toEqual({ pid: running.pid, started: false })
      expect(mocks.spawnDetached).not.toHaveBeenCalled()
    } finally {
      running.kill()
    }
  })

  it('starts once after clearing a stale pid', () => {
    const root = tree()
    writePid(root, 888_888_888)
    mocks.spawnDetached.mockReturnValue(4242)
    const result = startCollector(root)
    expect(result).toEqual({ pid: 4242, started: true })
    expect(readCollectorPid(root)).toBe(4242)
  })

  it('carries the resolved profile into the detached collector', () => {
    const root = tree()
    mocks.spawnDetached.mockReturnValue(4343)
    startCollector(root, 'remote-public')
    expect(mocks.spawnDetached).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--profile', 'remote-public', 'host', 'watch', '--loop']),
      expect.any(Object),
    )
  })
})
