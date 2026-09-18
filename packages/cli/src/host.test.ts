import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { fileMode, isPrivateAddress } from './host.ts'

describe('isPrivateAddress', () => {
  it('covers RFC 1918, loopback, link-local and the CGNAT range', () => {
    for (const address of [
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.20',
      '127.0.0.1',
      '169.254.1.1',
      '100.87.243.7',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('does not swallow the ranges either side of 172.16/12', () => {
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
  })

  it('refuses anything that is not four octets', () => {
    expect(isPrivateAddress('')).toBe(false)
    expect(isPrivateAddress('10.0.0')).toBe(false)
    expect(isPrivateAddress('10.0.0.256')).toBe(false)
    expect(isPrivateAddress('not-an-address')).toBe(false)
  })
})

describe('fileMode', () => {
  it('reports the octal mode the shell reports, so the two agree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-host-'))
    try {
      const file = join(dir, 'app.pem')
      writeFileSync(file, 'key')
      chmodSync(file, 0o600)
      expect(fileMode(file)).toBe('600')
      chmodSync(file, 0o644)
      expect(fileMode(file)).toBe('644')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
