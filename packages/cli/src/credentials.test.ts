import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  credentialsPath,
  findCredential,
  forgetCredential,
  panelKey,
  readCredentials,
  saveCredential,
} from './credentials.js'

function scratch(): string {
  return join(mkdtempSync(join(tmpdir(), 'portta-credentials-')), 'portta/credentials.json')
}

const CREDENTIAL = { token: 'ptt_secret', user: 'ada@example.test', role: 'owner', savedAt: '2026-09-04T00:00:00.000Z' }

describe('where the store lives', () => {
  it('respects XDG_CONFIG_HOME, like everything else on the host', () => {
    expect(credentialsPath({ XDG_CONFIG_HOME: '/x/config', HOME: '/home/ada' })).toBe(
      '/x/config/portta/credentials.json',
    )
    expect(credentialsPath({ HOME: '/home/ada' })).toBe('/home/ada/.config/portta/credentials.json')
  })
})

describe('one entry per panel', () => {
  // A laptop panel and a server panel are not the same credential, and the URL
  // is what tells them apart.
  it('keys on the URL, ignoring a trailing slash and the case', () => {
    expect(panelKey('https://Panel.example.com/')).toBe(panelKey('https://panel.example.com'))
  })

  it('saves, finds and forgets', () => {
    const path = scratch()
    saveCredential('http://127.0.0.1:8081', CREDENTIAL, path)
    expect(findCredential('http://127.0.0.1:8081/', path)).toEqual(CREDENTIAL)

    expect(forgetCredential('http://127.0.0.1:8081', path)).toBe(true)
    expect(findCredential('http://127.0.0.1:8081', path)).toBeNull()
    expect(forgetCredential('http://127.0.0.1:8081', path)).toBe(false)
  })

  it('keeps the others when one is forgotten', () => {
    const path = scratch()
    saveCredential('http://127.0.0.1:8081', CREDENTIAL, path)
    saveCredential('https://panel.example.com', { ...CREDENTIAL, user: 'grace@example.test' }, path)
    forgetCredential('http://127.0.0.1:8081', path)
    expect(Object.keys(readCredentials(path).panels)).toEqual(['https://panel.example.com'])
  })
})

describe('the file itself', () => {
  it('is owner-only, because it holds a credential', () => {
    const path = scratch()
    saveCredential('http://127.0.0.1:8081', CREDENTIAL, path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
  })

  // A corrupt file must not stop a command against a panel that needs no
  // credential at all: the worst it should cost is one clear "not signed in".
  it('reads as empty when it cannot be understood', () => {
    const path = scratch()
    saveCredential('http://127.0.0.1:8081', CREDENTIAL, path)
    writeFileSync(path, '{ not json', { mode: 0o600 })
    expect(readCredentials(path).panels).toEqual({})

    writeFileSync(path, JSON.stringify({ version: 99, panels: { a: CREDENTIAL } }), { mode: 0o600 })
    expect(readCredentials(path).panels).toEqual({})
    chmodSync(path, 0o600)
  })
})
