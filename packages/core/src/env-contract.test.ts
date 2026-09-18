import { copyFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEnv, patchEnvFile, prepareEnvFile } from './env.ts'

const root = resolve(import.meta.dirname, '../../..')
const template = '# Portta environment structure: 1\n# Panel\nA=one\nB=two\n\n# Database\nC=three\n'

function fixture(text: string) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-contract-'))
  const file = join(directory, '.env')
  writeFileSync(join(directory, '.env.example'), template)
  writeFileSync(file, text)
  return file
}

describe('the installation environment contract', () => {
  it('fills missing keys while preserving unknown keys and personal comments', () => {
    const original = '# Personal note\nC=custom # Personal inline note\nA=chosen\nCUSTOM=retained\n'
    const file = fixture(original)
    prepareEnvFile(file)
    const result = readFileSync(file, 'utf8')
    expect(result).toContain('# Personal note')
    expect(result).toContain('C=custom # Personal inline note')
    expect(result).toContain('CUSTOM=retained')
    expect(parseEnv(result).get('B')).toBe('two')
    expect(result).toContain('PORTTA_AUTH_SECRET=')
    prepareEnvFile(file)
    expect(readFileSync(file, 'utf8')).toBe(result)
  })

  it('creates from the real template, persists secrets, and is idempotent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-prepare-'))
    const file = join(directory, '.env')
    copyFileSync(join(root, '.env.example'), join(directory, '.env.example'))
    prepareEnvFile(file)
    const text = readFileSync(file, 'utf8')
    const modified = statSync(file).mtimeMs
    expect([...parseEnv(text).keys()]).toEqual([...parseEnv(readFileSync(join(root, '.env.example'), 'utf8')).keys()])
    expect(parseEnv(text).get('PORTTA_AUTH_SECRET')).toMatch(/^[a-f0-9]{64}$/)
    prepareEnvFile(file)
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(statSync(file).mtimeMs).toBe(modified)
  })

  it('serializes simultaneous TypeScript patches', async () => {
    const file = fixture(template)
    await Promise.all([
      Promise.resolve().then(() => patchEnvFile(file, { A: 'first' })),
      Promise.resolve().then(() => patchEnvFile(file, { B: 'second' })),
    ])
    expect(Object.fromEntries(parseEnv(readFileSync(file, 'utf8')))).toMatchObject({
      A: 'first',
      B: 'second',
      C: 'three',
    })
  })
})
