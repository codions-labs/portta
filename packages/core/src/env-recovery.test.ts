import { afterEach, expect, it, vi } from 'vitest'

const failure = vi.hoisted(() => ({ file: '', active: false }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (failure.active && args[0] === failure.file) {
        failure.active = false
        fs.writeFileSync(args[0], 'partial')
        throw new Error('simulated interrupted write')
      }
      return fs.writeFileSync(...args)
    },
  }
})

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patchEnvFile } from './env.ts'

afterEach(() => {
  failure.active = false
})
it('restores an interrupted write without replacing the file bind inode', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'portta-recovery-')), '.env')
  writeFileSync(file, '# Preserved\nA=original\n')
  const inode = statSync(file).ino
  failure.file = file
  failure.active = true
  expect(() => patchEnvFile(file, { A: 'changed' })).toThrow('interrupted')
  expect(readFileSync(file, 'utf8')).toBe('# Preserved\nA=original\n')
  expect(statSync(file).ino).toBe(inode)
  patchEnvFile(file, { A: 'next' })
  expect(readFileSync(file, 'utf8')).toBe('# Preserved\nA=next\n')
})
