import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeEnvironment, parseEnv, setEnvValue, writeEnvFile } from './env.js'

describe('environment files', () => {
  it('parses without evaluating shell syntax', () => {
    const env = parseEnv("A=one\nB='two words'\nBAD LINE\nC=`touch /tmp/nope`\n")
    expect(Object.fromEntries(env)).toEqual({ A: 'one', B: 'two words', C: '`touch /tmp/nope`' })
  })
  it('lets the installation environment win', () =>
    expect(mergeEnvironment(new Map([['A', 'file']]), { A: 'process' }).A).toBe('file'))
  // .env is bind-mounted into the panel container as a single file, and a file
  // bind follows the inode. An atomic rename here left the panel holding an
  // unlinked file and reporting .env as missing until it was recreated, and any
  // host-side write did it. The inode is the contract.
  it('rewrites .env without replacing it, so a file bind mount survives', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'portta-env-')), '.env')
    writeFileSync(file, 'A=one\n', { mode: 0o600 })
    const before = statSync(file).ino

    writeEnvFile(file, 'A=two\n')

    expect(readFileSync(file, 'utf8')).toBe('A=two\n')
    expect(statSync(file).ino).toBe(before)
  })

  // writeFileSync's `mode` applies only when it creates the file, and writing
  // in place never does. .env holds secrets.
  it('tightens the file to owner-only even when it already existed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'portta-env-')), '.env')
    writeFileSync(file, 'A=one\n', { mode: 0o644 })
    writeEnvFile(file, 'A=two\n')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('leaves no temporary file behind', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-env-'))
    const file = join(directory, '.env')
    writeEnvFile(file, 'A=one\n')
    writeEnvFile(file, 'A=two\n')
    expect(readdirSync(directory)).toEqual(['.env'])
  })
})

describe('canonical environment contract', () => {
  const template = '# Portta environment structure: 1\n# Panel\nA=one\nB=two\n\n# Database\nC=three\n'
  it('preserves CRLF, export, spacing, quotes, inline comments and unrelated lines', () => {
    const before = '# Panel\r\n  export A = "8081"  # port\r\n\r\nB=unchanged\r\n'
    expect(setEnvValue(before, 'A', '9000')).toBe(before.replace('8081', '9000'))
  })
  it('inserts a missing key before the next group', () => {
    const before = template.replace('B=two\n', '')
    expect(setEnvValue(before, 'B', 'two', template)).toBe(template)
  })
  it('rejects duplicate keys rather than editing a shadowed value', () => {
    expect(() => setEnvValue('A=one\nA=two\n', 'A', 'three')).toThrow('duplicate')
  })
  it('round trips literal credential characters', () => {
    for (const value of ['a$b#c', "a'b\\c", 'two words', 'a=b', '`literal`']) {
      expect(parseEnv(setEnvValue('A=\n', 'A', value)).get('A')).toBe(value)
    }
  })
})
