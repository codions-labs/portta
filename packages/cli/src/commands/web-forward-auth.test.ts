import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderAliases } from 'portta-core'
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
})
