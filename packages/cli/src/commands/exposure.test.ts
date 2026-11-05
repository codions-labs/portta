import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAliases, renderAliases } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { emptyProtectionStore, openStore, protectedStore, saveExposure } from './exposure.js'

describe('saving an exposure decision', () => {
  it('suspends a conflicting alias immediately and preserves its stored state', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-exposure-'))
    const dynamic = join(root, 'config/traefik/dynamic')
    mkdirSync(dynamic, { recursive: true })
    const file = join(dynamic, 'portta-aliases.yaml')
    const alias = {
      project: 'old',
      service: 'web',
      container: 'old-web-1',
      host: 'new--web.example.test',
      port: 80,
      entryPoint: 'websecure',
    }
    writeFileSync(file, renderAliases([alias], true))
    const store = openStore(emptyProtectionStore(), {
      host: alias.host,
      entryPoint: 'websecure',
      project: 'new',
      service: 'web',
    })

    saveExposure(root, store, 'remote-public')

    const rendered = readFileSync(file, 'utf8')
    expect(rendered).not.toContain('Host(`new--web.example.test`)')
    expect(parseAliases(rendered)).toEqual([alias])
  })
})

describe('protecting a host with a password alone', () => {
  it('stores no username, and keeps one when asked for', async () => {
    const base = { host: 'shop.example.test', entryPoint: 'websecure', password: 'secret-enough' }
    const alone = (await protectedStore(emptyProtectionStore(), { ...base, user: null })).protections[0]
    expect(alone).not.toHaveProperty('user')
    expect(alone?.mode).toBe('protected')
    const named = (await protectedStore(emptyProtectionStore(), { ...base, user: 'reviewer' })).protections[0]
    expect(named?.user).toBe('reviewer')
  })
})
