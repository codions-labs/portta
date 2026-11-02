import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAliases, renderAliases, setProtection, writeProtectionStore } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { syncForwardAuth } from './web.js'

const ALIAS = {
  project: 'shop',
  service: 'web',
  container: 'shop-web-1',
  host: 'store.example.test',
  port: 3000,
  entryPoint: 'websecure',
}

describe('syncForwardAuth', () => {
  it('puts an alias written on a private host behind ForwardAuth when the host goes public, and back', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-sync-'))
    const dynamic = join(root, 'config/traefik/dynamic')
    mkdirSync(dynamic, { recursive: true })
    const file = join(dynamic, 'portta-aliases.yaml')
    writeFileSync(file, renderAliases([ALIAS]))

    syncForwardAuth(root, 'remote-public')
    expect(readFileSync(file, 'utf8')).toContain('middlewares: [portta-forward-auth]')

    syncForwardAuth(root, 'remote-private')
    expect(readFileSync(file, 'utf8')).not.toContain('middlewares')
  })

  it('leaves out an alias whose hostname carries a decision made for another service', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-sync-'))
    const dynamic = join(root, 'config/traefik/dynamic')
    mkdirSync(dynamic, { recursive: true })
    mkdirSync(join(root, 'state/auth'), { recursive: true })
    const file = join(dynamic, 'portta-aliases.yaml')
    writeFileSync(file, renderAliases([ALIAS]))
    writeProtectionStore(
      join(root, 'state/auth/protections.json'),
      setProtection(
        { version: 1, protections: [] },
        {
          scope: 'host:store.example.test',
          host: 'store.example.test',
          entryPoints: ['websecure'],
          mode: 'public',
          label: 'store',
          project: 'other',
          service: 'web',
        },
      ),
    )

    syncForwardAuth(root, 'remote-public')
    const rendered = readFileSync(file, 'utf8')
    expect(rendered).not.toContain('Host(`store.example.test`)')
    expect(parseAliases(rendered)).toEqual([ALIAS])
  })
})
