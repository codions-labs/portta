import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INSTALLATION_DIRECTORIES } from '../installation-directories.ts'
import { backupPaths, parseManifest, REPAIR_MODES } from './maintenance.ts'

function fakeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-maint-'))
  writeFileSync(join(root, '.env'), 'PORTTA_PROFILE=local\n')
  writeFileSync(join(root, 'VERSION'), '0.4.0\n')
  mkdirSync(join(root, 'config/traefik/dynamic'), { recursive: true })
  mkdirSync(join(root, 'state/git'), { recursive: true })
  // Everything the installer can fetch again:
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'docker'))
  return root
}

describe('backupPaths', () => {
  // Including the code would make the archive a stale copy of the release, and
  // restoring it onto a newer Portta would quietly downgrade it while claiming
  // to restore data.
  it('takes what cannot be regenerated and leaves what the installer can fetch', () => {
    const root = fakeRoot()
    try {
      expect(backupPaths(root)).toEqual(['.env', 'VERSION', 'config', 'state'])
      for (const path of backupPaths(root)) expect(['bin', 'scripts', 'docker']).not.toContain(path)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names only what is there, so a partial installation still backs up', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-maint-'))
    try {
      writeFileSync(join(root, '.env'), '')
      expect(backupPaths(root)).toEqual(['.env'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the manifest', () => {
  it('refuses a document that is not one, rather than restoring from nothing', () => {
    expect(parseManifest('not json')).toBeNull()
    expect(parseManifest('{}')).toBeNull()
    expect(parseManifest('{"portta":"0.4.0"}')).toBeNull()
  })

  it('requires every current manifest field', () => {
    expect(parseManifest('{"version":1}')).toBeNull()
  })
})

describe('the repair plan', () => {
  // A missing bind-mount directory makes Docker create it as root, which then
  // breaks the panel writing to it. Creating it with the mode it must end up
  // with is what stops the permission pass reporting work this list just made.
  it('creates the private directories private, not world-readable then fixed', () => {
    const byPath = new Map(INSTALLATION_DIRECTORIES.map((entry) => [entry.path, entry.mode]))
    expect(byPath.get('state/traefik/acme')).toBe(0o700)
    expect(byPath.get('state/cloudflared')).toBe(0o700)
    expect(byPath.get('state/git')).toBe(0o755)
  })

  it('agrees with itself: every directory it creates private, it also checks', () => {
    const checked = new Map(REPAIR_MODES.map((entry) => [entry.path, entry.mode]))
    for (const { path, mode } of INSTALLATION_DIRECTORIES) {
      if (mode !== 0o700) continue
      expect(checked.get(path), path).toBe(mode)
    }
  })

  it('covers every file that holds a secret', () => {
    const paths = REPAIR_MODES.map((entry) => entry.path)
    expect(paths).toContain('.env')
    expect(paths).toContain('state/traefik/acme/acme.json')
    expect(paths).toContain('state/cloudflared/credentials.json')
    for (const { path, mode } of REPAIR_MODES) {
      if (path.endsWith('.json') || path === '.env') expect(mode, path).toBe(0o600)
    }
  })
})
