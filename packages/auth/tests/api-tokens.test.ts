// A token, and the two things that make it safe: it never exceeds its owner,
// and it stops working the moment anything about them changes.

import { eq } from 'drizzle-orm'
import { apiKeys, users } from 'portta-db'
import { describe, expect, it } from 'vitest'
import {
  AGENT_DEFAULT_PERMISSIONS,
  collectTokens,
  createToken,
  findToken,
  listTokens,
  permissionsOf,
  revokeToken,
  scopesFor,
  TokenRefused,
} from '../src/index.ts'
import { bearer, harness } from './harness.ts'

const PASSWORD = 'a-long-enough-password'

async function panel(role: 'owner' | 'developer' | 'viewer' = 'owner') {
  const instance = await harness({ mode: 'protected' })
  await instance.auth.api.signUpEmail({ body: { name: 'Ada', email: 'owner@example.test', password: PASSWORD } })
  const [user] = await instance.db.select().from(users).where(eq(users.email, 'owner@example.test'))
  if (role !== 'owner') await instance.db.update(users).set({ role }).where(eq(users.id, user!.id))
  return { instance, userId: user!.id }
}

describe('what a new token holds', () => {
  it('is what agents hold, when nothing is asked for', () => {
    const scopes = scopesFor('owner', { actorKind: 'agent' })
    expect(scopes).toEqual([...AGENT_DEFAULT_PERMISSIONS].sort())
  })

  // A person's token is them. An agent's is not, which is the whole point of
  // the distinction: an agent left running should not be able to destroy an
  // environment because a prompt went sideways.
  it("is the whole role, when the token is a person's", () => {
    expect(scopesFor('developer', { actorKind: 'human' })).toEqual([...permissionsOf('developer')].sort())
  })

  it('is narrowed to the role, whatever the role is', () => {
    const scopes = scopesFor('viewer', { actorKind: 'agent' })
    expect(scopes.every((scope) => permissionsOf('viewer').has(scope))).toBe(true)
    expect(scopes).not.toContain('issue:write')
  })

  it('refuses a scope the owner does not hold, and names it', () => {
    expect(() => scopesFor('viewer', { scopes: ['issue:read', 'environment:destroy'] })).toThrow(/environment:destroy/)
    expect(() => scopesFor('viewer', { scopes: ['issue:read', 'environment:destroy'] })).toThrow(TokenRefused)
  })

  it('refuses a scope that is not a permission at all', () => {
    expect(() => scopesFor('owner', { scopes: ['issue:read', 'everything:always'] })).toThrow(/everything:always/)
  })

  it('takes exactly what was asked for, when it fits', () => {
    expect(scopesFor('developer', { scopes: ['issue:write', 'issue:read', 'issue:read'] })).toEqual([
      'issue:read',
      'issue:write',
    ])
  })
})

describe('creating one', () => {
  it('shows the secret once and stores only a hash of it', async () => {
    const { instance, userId } = await panel()
    const created = await createToken(instance, { userId, name: 'ci' })

    expect(created.token).toMatch(/^ptt_/)
    const [row] = await instance.db.select().from(apiKeys).where(eq(apiKeys.id, created.record.id))
    expect(row!.key).not.toContain(created.token)
    expect(JSON.stringify(await listTokens(instance.db))).not.toContain(created.token)
  })

  it('answers as the principal its owner is, narrowed to its scopes', async () => {
    const { instance, userId } = await panel()
    const created = await createToken(instance, { userId, name: 'ci', scopes: ['issue:read', 'logs:read'] })

    const principal = await instance.resolver.fromHeaders(bearer(created.token))
    expect(principal).toMatchObject({ kind: 'token', role: 'owner', actorKind: 'agent' })
    expect([...principal!.permissions].sort()).toEqual(['issue:read', 'logs:read'])
  })

  it('refuses to belong to a banned account', async () => {
    const { instance, userId } = await panel()
    await instance.db.update(users).set({ banned: true }).where(eq(users.id, userId))
    await expect(createToken(instance, { userId, name: 'ci' })).rejects.toThrow(/banned/)
  })

  it('refuses an expiry outside a year', async () => {
    const { instance, userId } = await panel()
    await expect(createToken(instance, { userId, name: 'ci', expiresInDays: 400 })).rejects.toThrow(/1 and 365/)
  })
})

describe('listing', () => {
  it('says who owns each one, and never the secret', async () => {
    const { instance, userId } = await panel()
    const ci = await createToken(instance, { userId, name: 'ci' })
    const laptop = await createToken(instance, { userId, name: 'laptop', actorKind: 'human' })

    const all = await listTokens(instance.db)
    expect(all.map((token) => token.name).sort()).toEqual(['ci', 'laptop'])
    expect(all.every((token) => token.userEmail === 'owner@example.test')).toBe(true)
    expect(all.find((token) => token.name === 'laptop')?.actorKind).toBe('human')

    // `start` is deliberately in there — the first characters, so a person can
    // tell two tokens apart. What must not be is either whole secret.
    const rendered = JSON.stringify(all)
    expect(rendered).not.toContain(ci.token)
    expect(rendered).not.toContain(laptop.token)
    expect(all.every((token) => (token.start ?? '').length < ci.token.length)).toBe(true)
  })
})

describe('revoking', () => {
  it('stops the next request, and leaves the row to say so', async () => {
    const { instance, userId } = await panel()
    const created = await createToken(instance, { userId, name: 'ci' })
    expect(await instance.resolver.fromHeaders(bearer(created.token))).not.toBeNull()

    expect(await revokeToken(instance.db, created.record.id)).toBe(true)
    expect(await instance.resolver.fromHeaders(bearer(created.token))).toBeNull()

    const after = await findToken(instance.db, created.record.id)
    expect(after).toMatchObject({ name: 'ci', enabled: false })
  })
})

describe('housekeeping', () => {
  // Nothing here can end a token somebody is still using: the thresholds are
  // thirty days past an expiry and ninety past a revocation.
  it('disables what expired long ago and removes what was revoked long ago', async () => {
    const { instance, userId } = await panel()
    const recent = await createToken(instance, { userId, name: 'recent' })
    const stale = await createToken(instance, { userId, name: 'stale' })
    const ancient = await createToken(instance, { userId, name: 'ancient' })

    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await instance.db.update(apiKeys).set({ expiresAt: longAgo }).where(eq(apiKeys.id, stale.record.id))
    await instance.db
      .update(apiKeys)
      .set({ enabled: false, expiresAt: longAgo, updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) })
      .where(eq(apiKeys.id, ancient.record.id))

    expect(await collectTokens(instance.db)).toEqual({ disabled: 1, removed: 1 })
    expect((await findToken(instance.db, stale.record.id))?.enabled).toBe(false)
    expect(await findToken(instance.db, ancient.record.id)).toBeNull()
    expect((await findToken(instance.db, recent.record.id))?.enabled).toBe(true)
  })
})
