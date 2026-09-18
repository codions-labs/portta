import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { gatewaySourceFiles } from '../lib/gateway-source.mjs'

test('gateway source includes tracked dynamic config but excludes generated runtime files', () => {
  const root = mkdtempSync(join(tmpdir(), 'portta-gateway-source-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const write = (path, content = '') => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  try {
    git('init', '-q')
    write('config/traefik/dynamic/tcp.yaml', 'tls: {}\n')
    write('tracked.txt')
    git('add', '.')
    write('config/traefik/dynamic/portta-auth.yaml', 'secret\n')
    write('state/auth/credentials.json', 'secret\n')
    write('.env', 'SECRET=value\n')
    write('untracked.txt')

    assert.deepEqual(gatewaySourceFiles(root).sort(), [
      'config/traefik/dynamic/tcp.yaml',
      'tracked.txt',
      'untracked.txt',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
