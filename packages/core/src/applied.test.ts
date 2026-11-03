import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { APPLIED_FILE, differsFromApplied, readApplied, writeApplied } from './applied.ts'

describe('the applied settings record', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const home = () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-applied-'))
    dirs.push(dir)
    return dir
  }

  it('never writes a secret, only its digest, and compares by it', () => {
    const root = home()
    writeApplied(
      root,
      new Map([
        ['PORTTA_DOMAIN', 'a.test'],
        ['TS_AUTHKEY', 'tskey-1'],
      ]),
    )
    expect(readFileSync(join(root, APPLIED_FILE), 'utf8')).not.toContain('tskey-1')
    const applied = readApplied(join(root, APPLIED_FILE))
    expect(applied).not.toBeNull()
    if (!applied) return
    expect(differsFromApplied(applied, 'TS_AUTHKEY', 'tskey-1')).toBe(false)
    expect(differsFromApplied(applied, 'TS_AUTHKEY', 'tskey-2')).toBe(true)
    expect(differsFromApplied(applied, 'PORTTA_DOMAIN', 'b.test')).toBe(true)
  })

  it('treats an absent key as empty, and an unreadable record as none', () => {
    const root = home()
    writeApplied(root, new Map())
    const applied = readApplied(join(root, APPLIED_FILE))
    expect(applied && differsFromApplied(applied, 'PORTTA_DOMAIN', null)).toBe(false)
    expect(applied && differsFromApplied(applied, 'PORTTA_DOMAIN', 'x')).toBe(true)
    expect(readApplied(join(root, 'missing.json'))).toBeNull()
  })
})
