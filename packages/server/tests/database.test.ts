// Persistence, from the panel's side.
//
// The schema itself — what the tables are, what they refuse, what a removal
// takes with it — is asserted in packages/db against the real migration. What
// is asserted here is what the panel does around it: the closed setting
// catalogue, the boundary a dropped connection produces, and the migrate
// endpoint.

import { eq } from 'drizzle-orm'
import { settings as settingsTable } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { Database, type DatabaseBackend, type DatabaseStatus, requireDatabase } from '../src/db/index.ts'
import { environmentSchema, GLOBAL_KEYS, globalSchema, serviceSchema, UnknownSettingKey } from '../src/db/keys.ts'
import { diagnose } from '../src/services/diagnostics.ts'
import { buildSnapshot } from '../src/services/inventory.ts'
import { FULL_HOST } from './fixtures.ts'
import { databasePerFile, detachedDatabase, fakeDocker, makeApp, post, testConfig } from './helpers.ts'

const seededDatabase = databasePerFile()

describe('the closed setting catalogue', () => {
  it('accepts only declared, validated values', () => {
    expect(globalSchema('theme').parse('dark')).toBe('dark')
    expect(environmentSchema('hiddenServices').parse(['mailpit'])).toEqual(['mailpit'])
    expect(serviceSchema('alias').parse('storefront-api')).toBe('storefront-api')
    expect(() => serviceSchema('alias').parse('Not A Host')).toThrow()
  })

  it('refuses an unknown key before any database call', () => {
    expect(() => globalSchema('arbitrarySql')).toThrow(UnknownSettingKey)
    expect(Object.keys(GLOBAL_KEYS)).not.toContain('arbitrarySql')
  })

  it('falls back to null when a hand-edited row is invalid', async () => {
    const seeded = await seededDatabase({ empty: true })
    await seeded.db.insert(settingsTable).values({ key: 'theme', value: 'neon-pink' })
    await expect(seeded.database.settings.getGlobal('theme')).resolves.toBeNull()
  })

  it('validates before writing, so an invalid value never reaches a row', async () => {
    const seeded = await seededDatabase({ empty: true })
    await expect(seeded.database.settings.setGlobal('theme', 'neon-pink' as never)).rejects.toThrow()
    expect(await seeded.db.select().from(settingsTable)).toHaveLength(0)

    await seeded.database.settings.setGlobal('theme', 'dark')
    const [row] = await seeded.db.select().from(settingsTable).where(eq(settingsTable.key, 'theme'))
    expect(row?.value).toBe('dark')
  })
})

describe('a connection the panel cannot reach', () => {
  // The database is a boot dependency, so "no database configured" is not a
  // state the panel can be in. A connection that drops after boot is.
  it('reports it as a warning rather than a failure', async () => {
    const config = testConfig()
    const docker = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(docker.client, config)
    const status: DatabaseStatus = {
      configured: true,
      available: false,
      reason: 'connection refused',
      checkedAt: null,
      migrations: [],
    }
    const database = diagnose(snapshot, config, null, [], status).find((check) => check.id === 'database')

    expect(database).toMatchObject({ status: 'warn', fix: 'portta db status' })
  })

  it('turns a persistence write into a clear 503 boundary', () => {
    expect(() => requireDatabase(detachedDatabase())).toThrow(/persistence is unavailable/)
  })

  it('answers 503 on the migrate endpoint', async () => {
    const { app } = makeApp()
    expect((await post(app, '/api/database/migrate')).status).toBe(503)
  })
})

describe('applying migrations', () => {
  /** A backend that counts what the panel asked it to do. */
  function counting(overrides: Partial<DatabaseBackend> = {}) {
    const calls = { migrate: 0, ping: 0 }
    const backend: DatabaseBackend = {
      migrate: async () => {
        calls.migrate += 1
      },
      applied: async () => ['0000_current'],
      ping: async () => {
        calls.ping += 1
      },
      close: async () => undefined,
      ...overrides,
    }
    return { backend, calls }
  }

  it('coalesces concurrent initialisations into one', async () => {
    const { backend, calls } = counting()
    const database = new Database(undefined as never, backend)

    await Promise.all([database.initialize(), database.initialize(), database.initialize()])

    expect(calls).toEqual({ migrate: 1, ping: 1 })
  })

  it('reports what a run applied that the last one had not', async () => {
    let applied = ['0000_current']
    const { backend } = counting({ applied: async () => applied })
    const database = new Database(undefined as never, backend)

    await database.initialize()
    applied = ['0000_current', '0001_later']

    await expect(database.applyMigrations()).resolves.toEqual({
      migrations: ['0000_current', '0001_later'],
      applied: ['0001_later'],
    })
  })

  // A database that was down at startup is not abandoned: the next Docker
  // snapshot retries, and identity is recorded once persistence recovers.
  it('retries at the next snapshot after a startup outage', async () => {
    let down = true
    const seeded = await seededDatabase({ empty: true })
    const database = new Database(seeded.db, {
      migrate: async () => {
        if (down) throw new Error('connection refused')
      },
      applied: async () => ['0000_current'],
      ping: async () => undefined,
      close: async () => undefined,
    })

    await expect(database.initialize()).rejects.toThrow('connection refused')
    expect(database.status().available).toBe(false)

    down = false
    await database.recordEnvironmentsSeen([{ name: 'demo-a', workingDir: null, repoUrl: null, gitRoot: null }])

    expect(database.status()).toMatchObject({ available: true, migrations: ['0000_current'] })
    expect(await database.environments.find('demo-a')).toMatchObject({ composeProject: 'demo-a' })
  })

  it('applies pending schema through the API without a restart', async () => {
    const seeded = await seededDatabase({ empty: true })
    const { app } = makeApp({}, {}, seeded.database)
    const response = await post(app, '/api/database/migrate')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ applied: [], migrations: ['0000_current'] })
  })

  it('applies schema even when the panel is read-only', async () => {
    const seeded = await seededDatabase({ empty: true })
    const { app } = makeApp({}, { readOnly: true }, seeded.database)
    expect((await post(app, '/api/database/migrate')).status).toBe(200)
  })
})
