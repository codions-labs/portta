import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySnapshot } from 'portta-core'
import { afterEach, describe, expect, it } from 'vitest'
import { currentFile, historyFile, instanceFile } from './paths.ts'
import { appendHistory, loadInstance, writeCurrent } from './store.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-metrics-'))
  roots.push(root)
  return root
}

describe('metrics store', () => {
  it('writes current.json atomically and keeps one stable instance id', () => {
    const root = tree()
    const first = loadInstance(root, 'studio')
    const second = loadInstance(root, 'studio')
    expect(first.id).toBe(second.id)
    expect(existsSync(instanceFile(root))).toBe(true)

    const snapshot = emptySnapshot(first, 1_700_000_000)
    const path = writeCurrent(root, snapshot)
    expect(path).toBe(currentFile(root))
    expect(JSON.parse(readFileSync(path, 'utf8')).instance.id).toBe(first.id)
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false)
  })

  it('prunes history older than one hour', () => {
    const root = tree()
    const instance = loadInstance(root, 'box')
    const old = emptySnapshot(instance, 1_700_000_000 - 4000)
    appendHistory(root, old)
    const now = emptySnapshot(instance, 1_700_000_000)
    now.host.cpuUtilisation = 0.2
    appendHistory(root, now)
    const lines = readFileSync(historyFile(root), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}').timestamp).toBe(1_700_000_000)
  })

  it('recreates a broken instance file instead of crashing', () => {
    const root = tree()
    mkdirSync(join(root, 'state/metrics'), { recursive: true })
    writeFileSync(instanceFile(root), '{nope')
    const instance = loadInstance(root, 'box')
    expect(instance.id.length).toBeGreaterThan(8)
  })
})
