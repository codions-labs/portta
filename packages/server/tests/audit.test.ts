// The audit log: what gets written, what never does, and what is read back.
//
// The reading half inserts rows directly, because nothing else can: no route
// writes to this table, on purpose. The writing half goes through the API, one
// case per action, because the thing worth testing is that the action reaches
// the log at all — a service that forgets the call is exactly the defect this
// suite exists to catch.

import type { Hono } from 'hono'
import { auditLog, type Db, users } from 'portta-db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUDIT_RETENTION_DAYS, collectAudit, listAudit, scrubMetadata } from '../src/services/audit.ts'
import { makeApp, type SeededDatabase, seededDatabase } from './helpers.ts'

let seeded: SeededDatabase
let db: Db
let app: Hono

const json = (response: Response) => response.json() as Promise<Record<string, any>>

beforeAll(async () => {
  seeded = await seededDatabase()
  db = seeded.db
  app = makeApp({}, {}, seeded.database).app

  // The rows point at real accounts: `user_id` is a foreign key, and an entry
  // whose account was removed keeps the email rather than a dangling id.
  await db.insert(users).values([
    { id: 'u-1', name: 'Ana', email: 'ana@example.test', role: 'owner' },
    { id: 'u-2', name: 'Rita', email: 'rita@example.test', role: 'developer' },
  ])

  const base = new Date('2026-01-01T10:00:00Z')
  await db.insert(auditLog).values(
    Array.from({ length: 5 }, (_, index) => ({
      at: new Date(base.getTime() + index * 60_000),
      userId: index % 2 === 0 ? 'u-1' : 'u-2',
      userEmail: index % 2 === 0 ? 'ana@example.test' : 'rita@example.test',
      principalKind: 'user' as const,
      actor: index % 2 === 0 ? 'ana' : 'rita',
      action: index === 4 ? ('user.created' as const) : ('user.role_changed' as const),
      resourceType: 'user',
      resourceId: `u-${index}`,
      resourceName: `person ${index}`,
      projectId: index === 0 ? Number(seeded.ids.project) : null,
      ipAddress: '10.0.0.4',
      metadata: {},
    })),
  )
})

afterAll(async () => {
  await seeded.close()
})

describe('the listing', () => {
  it('is newest first, and says the Project by its slug', async () => {
    const { entries } = await listAudit(db)
    expect(entries).toHaveLength(5)
    expect(entries[0]?.action).toBe('user.created')
    expect(entries.at(-1)?.project).toBe('produto')
    expect(entries[0]?.project).toBeNull()
  })

  it('pages by id, and says when there is nothing older', async () => {
    const first = await listAudit(db, { limit: 2 })
    expect(first.entries).toHaveLength(2)
    expect(first.nextBefore).not.toBeNull()

    const second = await listAudit(db, { limit: 2, before: first.nextBefore! })
    expect(second.entries.map((entry) => entry.id)).not.toEqual(first.entries.map((entry) => entry.id))

    const last = await listAudit(db, { limit: 500 })
    expect(last.nextBefore).toBeNull()
  })

  it('narrows to one account and to one action', async () => {
    const byUser = await listAudit(db, { userId: 'u-2' })
    expect(byUser.entries.every((entry) => entry.userEmail === 'rita@example.test')).toBe(true)

    const byAction = await listAudit(db, { action: 'user.created' })
    expect(byAction.entries).toHaveLength(1)
  })
})

describe('the route', () => {
  it('answers a page, and takes its filters from the query string', async () => {
    const body = await json(await app.request('/api/audit?limit=2'))
    expect(body.entries).toHaveLength(2)
    expect(body.nextBefore).toBeTruthy()

    const filtered = await json(await app.request('/api/audit?action=user.created'))
    expect(filtered.entries).toHaveLength(1)
  })

  it('ignores a filter it does not recognise rather than refusing the page', async () => {
    const body = await json(await app.request('/api/audit?action=nonsense&limit=abc'))
    expect(body.entries).toHaveLength(5)
  })
})

describe('what never reaches the log', () => {
  it('redacts a secret whatever a caller passes, at any depth', () => {
    const scrubbed = scrubMetadata({
      password: 'hunter2',
      note: 'the token is ptt_abcdef0123456789 and it works',
      hash: '$portta$scrypt$16384$8$1$abc',
      nested: { apiKeys: ['ptt_zzzzzzzzzzzz'], fine: 'a name' },
      keep: 42,
    })
    expect(scrubbed.password).toBe('[redacted]')
    expect(scrubbed.hash).toBe('[redacted]')
    expect(scrubbed.note).toBe('[redacted]')
    expect((scrubbed.nested as Record<string, unknown>).apiKeys).toBe('[redacted]')
    expect((scrubbed.nested as Record<string, unknown>).fine).toBe('a name')
    expect(scrubbed.keep).toBe(42)
  })

  it('keeps a very long value from becoming the log', () => {
    const scrubbed = scrubMetadata({ note: 'x'.repeat(4000) })
    expect((scrubbed.note as string).length).toBe(512)
  })

  it('and does not follow a shape somebody nested to hide a secret in', () => {
    const deep = scrubMetadata({ a: { b: { c: { d: { secret: 'ptt_deep' } } } } })
    expect(JSON.stringify(deep)).not.toContain('ptt_deep')
  })
})

describe('pruning', () => {
  it('forgets entries past the retention window and keeps the rest', async () => {
    const prune = await seededDatabase({ empty: true })
    const pruneDb = prune.db
    try {
      const old = new Date(Date.now() - (AUDIT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
      const recent = new Date(Date.now() - 24 * 60 * 60 * 1000)
      await pruneDb.insert(auditLog).values(
        [old, recent].map((at) => ({
          at,
          userId: null,
          userEmail: 'ana@example.test',
          principalKind: 'user' as const,
          actor: 'ana',
          action: 'settings.changed' as const,
          resourceType: 'settings',
          metadata: {},
        })),
      )
      expect(await collectAudit(pruneDb)).toBe(1)
      const left = await listAudit(pruneDb)
      expect(left.entries).toHaveLength(1)
      expect(left.entries[0]?.at).toBeGreaterThan(Math.floor(old.getTime() / 1000))
    } finally {
      await prune.close()
    }
  })
})
