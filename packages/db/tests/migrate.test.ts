// The migration applies, applying it twice changes nothing, and two processes
// racing it produce one migrated database rather than two half-migrated ones.
//
// The engine here is the engine in production — same driver, same generated
// SQL — so what runs is what will run, rather than an approximation of it.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appliedMigrations,
  MIGRATIONS_TABLE,
  migrateWithLock,
  migrationsFolder,
  migrationTags,
} from '../src/migrate.ts'
import { instance } from '../src/schema/instance.ts'
import { seedMinimal } from '../src/seed.ts'
import { createTestDb, type TestDatabase } from '../src/test-db.ts'

let open: TestDatabase | null = null
const temporary: string[] = []

afterEach(async () => {
  await open?.close()
  open = null
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function aDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'portta-migrate-'))
  temporary.push(directory)
  return directory
}

const migrationCount = () => readdirSync(migrationsFolder()).filter((name) => name.endsWith('.sql')).length

describe('the migrations', () => {
  it('creates exactly the tables the panel reads', async () => {
    open = await createTestDb()
    const tables = (
      open.client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)

    for (const expected of [
      'accounts',
      'activity_events',
      'api_keys',
      'audit_log',
      'environment_issues',
      'environment_settings',
      'environments',
      'instance',
      'project_environments',
      'project_members',
      'projects',
      'repositories',
      'service_settings',
      'sessions',
      'settings',
      'ssh_keys',
      'two_factors',
      'users',
      'verifications',
      'work_sessions',
    ]) {
      expect(tables, expected).toContain(expected)
    }

    // Portta owns no task and mirrors no issue (ADR 0050, ADR 0018). The schema
    // has no table for either, so nothing can quietly start writing one.
    for (const gone of [
      'tasks',
      'task_notes',
      'task_attachments',
      'task_github_links',
      'task_environments',
      'github_installations',
      'github_repositories',
      'github_issues',
      'github_issue_relationships',
      'github_sync_state',
    ]) {
      expect(tables, gone).not.toContain(gone)
    }
  })

  it('is idempotent: applying it again applies nothing', () => {
    const path = join(aDirectory(), 'portta.db')
    migrateWithLock(path)
    migrateWithLock(path)
    const client = new Database(path)
    try {
      const row = client.prepare(`SELECT count(*) AS count FROM "${MIGRATIONS_TABLE}"`).get() as { count: number }
      expect(row.count).toBe(migrationCount())
      expect(appliedMigrations(client)).toEqual(migrationTags())
    } finally {
      client.close()
    }
  })

  // The lock is `BEGIN IMMEDIATE`. What must hold is that a panel and a
  // `portta db migrate` starting together leave one migrated database, not a
  // half-applied one.
  it('serialises two processes racing the same database', async () => {
    const path = join(aDirectory(), 'portta.db')
    await Promise.all([
      Promise.resolve().then(() => migrateWithLock(path)),
      Promise.resolve().then(() => migrateWithLock(path)),
    ])
    const client = new Database(path)
    try {
      const row = client.prepare(`SELECT count(*) AS count FROM "${MIGRATIONS_TABLE}"`).get() as { count: number }
      expect(row.count).toBe(migrationCount())
    } finally {
      client.close()
    }
  })

  it('reports nothing applied for a database that has never been migrated', () => {
    const client = new Database(':memory:')
    try {
      expect(appliedMigrations(client)).toEqual([])
    } finally {
      client.close()
    }
  })

  // A migration run must not leave a handle behind: the panel opens its own
  // connection immediately afterwards, and on Windows or a bind mount a stray
  // handle is a locked file rather than a warning.
  it('opens and closes its own connection', () => {
    const path = join(aDirectory(), 'portta.db')
    migrateWithLock(path)
    const client = new Database(path)
    client.close()
  })
})

describe('the seed', () => {
  it('creates the one identity row, and only one however often it runs', async () => {
    open = await createTestDb()
    seedMinimal(open.db)
    seedMinimal(open.db)
    const rows = open.db.select().from(instance).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('portta')
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('the pragmas a Portta database is opened with', () => {
  // Foreign keys are off by default in SQLite, which would make every
  // `references(...)` in the schema decorative — including the cascades a
  // Project delete depends on.
  it('enforces foreign keys, which SQLite does not do by default', async () => {
    open = await createTestDb()
    expect(open.client.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})

describe('what the driver does with the generated SQL', () => {
  it('applies the baseline onto a database drizzle opened itself', () => {
    const client = new Database(':memory:')
    try {
      migrate(drizzle(client), { migrationsFolder: migrationsFolder(), migrationsTable: MIGRATIONS_TABLE })
      const row = client.prepare(`SELECT count(*) AS count FROM "${MIGRATIONS_TABLE}"`).get() as { count: number }
      expect(row.count).toBe(migrationCount())
    } finally {
      client.close()
    }
  })
})
