import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DynamicWriteRefused, GENERATED_FILES, writeGenerated } from '../src/services/dynamic.ts'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'portta-dynamic-'))
}

describe('the dynamic write allowlist', () => {
  it('writes exactly the current generated files', () => {
    const dir = scratch()
    const expected = Object.values(GENERATED_FILES)
    for (const name of expected) writeGenerated(dir, name, 'http: {}\n')
    expect(readdirSync(dir).sort()).toEqual([...expected].sort())
  })

  it('refuses user files and paths outside the directory', () => {
    const dir = scratch()
    for (const name of [
      'middlewares.yaml',
      'tcp.yaml',
      'local-tls.yaml',
      '../compose.yaml',
      '/etc/passwd',
      'sub/unknown.yaml',
    ]) {
      expect(() => writeGenerated(dir, name, 'http: {}\n')).toThrow(DynamicWriteRefused)
    }
  })

  it('writes private files atomically', () => {
    const dir = scratch()
    writeGenerated(dir, GENERATED_FILES.auth, 'http: {}\n')
    expect(statSync(join(dir, GENERATED_FILES.auth)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([GENERATED_FILES.auth])
  })
})
