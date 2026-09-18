import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SshKey, SshKeys } from 'portta-contracts'
import { auditLog, seedMinimal } from 'portta-db'
import { afterEach, describe, expect, it } from 'vitest'
import { forgeKnownHosts, forgeTestResult, parseFingerprint, parsePublicKey } from '../src/services/ssh-keys.ts'
import { databasePerFile, del, makeApp, post } from './helpers.ts'

const seededDatabase = databasePerFile()

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

describe('SSH key helpers', () => {
  it('recognises supported public keys and SHA256 fingerprints', () => {
    expect(parsePublicKey('ssh-ed25519 AAAA comment')).toEqual({ algorithm: 'ed25519', bits: null })
    expect(parsePublicKey('ssh-rsa AAAA comment')).toEqual({ algorithm: 'rsa', bits: null })
    expect(() => parsePublicKey('ecdsa-sha2-nistp256 AAAA')).toThrow(/only ED25519 and RSA/)
    expect(parseFingerprint('4096 SHA256:abcDEF+/ comment (RSA)')).toEqual({
      bits: 4096,
      fingerprint: 'SHA256:abcDEF+/',
    })
  })

  it('pins published forge host keys so a test never accepts the first answer', () => {
    expect(forgeKnownHosts('github.com')).toContain('github.com ssh-ed25519 ')
    expect(forgeKnownHosts('gitlab.com')).toContain('gitlab.com ssh-ed25519 ')
    expect(forgeKnownHosts('bitbucket.org')).toContain('bitbucket.org ssh-ed25519 ')
    expect(forgeKnownHosts('github.com')).not.toContain('accept-new')
  })

  it('accepts forge success greetings even when the SSH endpoint exits one', () => {
    expect(
      forgeTestResult('github.com', { code: 1, stdout: '', stderr: "Hi ada! You've successfully authenticated" }).ok,
    ).toBe(true)
    expect(forgeTestResult('github.com', { code: 255, stdout: '', stderr: 'Permission denied (publickey).' })).toEqual({
      host: 'github.com',
      ok: false,
      message: 'github.com did not accept this key.',
    })
  })
})

describe('SSH key API', () => {
  it('generates, imports, lists and removes without exposing private material', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-ssh-'))
    const seeded = await seededDatabase({ empty: true })
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    await seedMinimal(seeded.db)
    const { app } = makeApp({}, { sshDir: directory }, seeded.database)

    const generatedResponse = await post(app, '/api/ssh/keys', { name: 'deploy', algorithm: 'ed25519' })
    expect(generatedResponse.status).toBe(201)
    const generated = SshKey.parse(await generatedResponse.json())
    expect(generated).toMatchObject({ name: 'deploy', algorithm: 'ed25519', bits: null, origin: 'generated' })
    expect(JSON.stringify(generated)).not.toContain('private')
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    expect(statSync(join(directory, generated.id)).mode & 0o777).toBe(0o600)
    expect(statSync(join(directory, `${generated.id}.pub`)).mode & 0o777).toBe(0o644)

    const privateKey = readFileSync(join(directory, generated.id), 'utf8')
    const importedResponse = await post(app, '/api/ssh/keys/import', {
      name: 'imported',
      description: 'external deploy key',
      privateKey,
    })
    expect(importedResponse.status).toBe(201)
    const imported = SshKey.parse(await importedResponse.json())
    expect(imported).toMatchObject({ name: 'imported', origin: 'imported', fingerprint: generated.fingerprint })
    expect(JSON.stringify(imported)).not.toContain(privateKey.slice(0, 30))

    const listed = SshKeys.parse(await (await app.request('/api/ssh/keys')).json())
    expect(listed.keys.map((key) => key.name)).toEqual(['deploy', 'imported'])
    expect(Object.keys(listed.keys[0] ?? {})).not.toContain('privateKey')

    const duplicate = await post(app, '/api/ssh/keys', { name: 'DEPLOY', algorithm: 'rsa' })
    expect(duplicate.status).toBe(409)

    const removed = await del(app, `/api/ssh/keys/${imported.id}`)
    expect(removed.status).toBe(200)
    expect(() => statSync(join(directory, imported.id))).toThrow()

    const audit = await seeded.db.select().from(auditLog)
    expect(audit.map((entry) => entry.action)).toEqual(['ssh.key_created', 'ssh.key_imported', 'ssh.key_removed'])
    expect(JSON.stringify(audit)).not.toContain(privateKey.slice(0, 30))
    expect(audit.map((entry) => ({ name: entry.resourceName, metadata: entry.metadata }))).toEqual([
      { name: 'deploy', metadata: { fingerprint: generated.fingerprint } },
      { name: 'imported', metadata: { fingerprint: generated.fingerprint } },
      { name: 'imported', metadata: { fingerprint: generated.fingerprint } },
    ])
  })

  it('generates RSA keys at exactly 4096 bits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-ssh-rsa-'))
    const seeded = await seededDatabase({ empty: true })
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    await seedMinimal(seeded.db)
    const { app } = makeApp({}, { sshDir: directory }, seeded.database)

    const response = await post(app, '/api/ssh/keys', { name: 'external-rsa', algorithm: 'rsa' })
    expect(response.status).toBe(201)
    expect(SshKey.parse(await response.json())).toMatchObject({
      name: 'external-rsa',
      algorithm: 'rsa',
      bits: 4096,
      origin: 'generated',
    })
  })

  it('returns a generic error for invalid private material', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-ssh-'))
    const seeded = await seededDatabase({ empty: true })
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    await seedMinimal(seeded.db)
    const { app } = makeApp({}, { sshDir: directory }, seeded.database)
    // Assemble the fixture at runtime so repository secret scanners do not
    // have to exempt a file containing a real private-key marker.
    const secret = `${['-----BEGIN ', 'PRIVATE KEY-----'].join('')}\n${'not-a-key'.repeat(8)}\n${['-----END ', 'PRIVATE KEY-----'].join('')}`
    const response = await post(app, '/api/ssh/keys/import', { name: 'broken', privateKey: secret })
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).not.toContain('not-a-key')
    expect(body).not.toContain('PRIVATE KEY')
  })
})
