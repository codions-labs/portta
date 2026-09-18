import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'

describe('how the panel names its own version', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is the installed VERSION when the image did not say otherwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-version-'))
    try {
      const file = join(dir, 'VERSION')
      writeFileSync(file, '0.8.0\n')
      vi.stubEnv('PORTTA_RUNTIME_VERSION_FILE', file)
      vi.stubEnv('PORTTA_RUNTIME_VERSION', '')
      const config = loadConfig()
      expect(config.gatewayVersion).toBe('0.8.0')
      expect(config.panelVersion).toBe('0.8.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is the image version when PORTTA_RUNTIME_VERSION is set, even if they disagree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-version-'))
    try {
      const file = join(dir, 'VERSION')
      writeFileSync(file, '0.8.0\n')
      vi.stubEnv('PORTTA_RUNTIME_VERSION_FILE', file)
      vi.stubEnv('PORTTA_RUNTIME_VERSION', '0.7.2')
      const config = loadConfig()
      expect(config.gatewayVersion).toBe('0.8.0')
      expect(config.panelVersion).toBe('0.7.2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
