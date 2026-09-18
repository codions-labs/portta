// What a fresh installation actually is, asserted end to end.
//
// Every other test here builds a panel from a harness. This one starts from the
// `.env.example` that ships, runs what `portta setup` runs, and opens the
// database on the path that produces — because the thing most likely to break
// is not a route, it is the chain between the template, the resolver and the
// first boot, and nothing else crosses all three.
//
// Docker is the one part it cannot reach. Everything up to "the panel has a
// migrated database it can read its own writes back from" is here.

import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSecurityMode } from 'portta-auth-core'
import { databaseFileFor, parseEnv, prepareEnvFile, resolveDatabase } from 'portta-core'
import { instance, seedMinimal, settings } from 'portta-db'
import { expect, it } from 'vitest'
import { Database } from '../src/db/index.ts'

const REPO = join(import.meta.dirname, '..', '..', '..')

it('comes up on SQLite with no authentication and nothing to configure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'portta-fresh-'))
  cpSync(join(REPO, '.env.example'), join(root, '.env.example'))

  // 1. what `portta setup` writes
  prepareEnvFile(join(root, '.env'))
  const env = Object.fromEntries(parseEnv(readFileSync(join(root, '.env'), 'utf8')))

  expect(env.PORTTA_AUTH_MODE).toBe('disabled')
  expect(env.PORTTA_RUNTIME_DATABASE_FILE).toBe('/app/state/panel/portta.db')
  expect(env.PORTTA_AUTH_SECRET).toMatch(/^[a-f0-9]{64}$/)
  // Nothing left that names a database server.
  expect(
    Object.keys(env).filter((k) => /DB_MODE|DB_PASSWORD|DATABASE_URL|DB_NETWORK|DB_VOLUME|GITHUB_APP/.test(k)),
  ).toEqual([])

  // 2. the mode that .env resolves to, with no edits
  const security = resolveSecurityMode(env)
  expect(security.mode).toBe('open')
  expect(security.secret).not.toBeNull()

  // 3. the database the panel opens, on the host's own path
  const file = databaseFileFor(root)
  expect(resolveDatabase({}, root).path).toBe(file)
  expect(existsSync(file)).toBe(false)

  const database = Database.open(file)
  try {
    await database.initialize()
    expect(database.status().available).toBe(true)
    expect(database.status().migrations).toEqual(['0000_current'])
    expect(existsSync(file)).toBe(true)

    seedMinimal(database.handle)
    expect(database.handle.select().from(instance).all()).toHaveLength(1)

    // It can actually be written to and read back.
    database.handle
      .insert(settings)
      .values({ key: 'k', value: { a: 1 } })
      .run()
    expect(database.handle.select().from(settings).all()[0]?.value).toEqual({ a: 1 })
  } finally {
    await database.close()
  }

  // 4. re-opening it finds what was written, and migrates nothing twice
  const again = Database.open(file)
  try {
    await again.initialize()
    expect(again.status().migrations).toEqual(['0000_current'])
    expect(again.handle.select().from(settings).all()).toHaveLength(1)
  } finally {
    await again.close()
  }
}, 60_000)

// Criterion 2: the same installation with the login on bootstraps its owner.
it('bootstraps the first owner when the login is on', async () => {
  const { bootstrapOwner, createAuth, hasOwner, SetupClosed } = await import('portta-auth-core')
  const { createTestDb } = await import('portta-db/testing')
  const { db } = await createTestDb()
  const security = resolveSecurityMode({ PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'x'.repeat(32) })
  expect(security.mode).toBe('protected')

  const authFor = (handle: typeof db) => createAuth({ db: handle, security, hasOwner: () => hasOwner(handle) })
  expect(await hasOwner(db)).toBe(false)

  const created = await bootstrapOwner(
    authFor,
    db,
    { name: 'Ada', email: 'ada@example.test', password: 'a-long-enough-password' },
    new Headers(),
  )
  expect(created.user.email).toBe('ada@example.test')
  expect(await hasOwner(db)).toBe(true)

  // Once, and the second attempt is a refusal rather than a second owner.
  await expect(
    bootstrapOwner(
      authFor,
      db,
      { name: 'Bob', email: 'bob@example.test', password: 'a-long-enough-password' },
      new Headers(),
    ),
  ).rejects.toBeInstanceOf(SetupClosed)
}, 60_000)
