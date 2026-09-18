// Who a request is, from what it carries.

import { eq } from 'drizzle-orm'
import { users } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { AGENT_DEFAULT_PERMISSIONS, PERMISSIONS, permissionsOf, READ_PERMISSIONS } from '../src/index.ts'
import { bearer, type Harness, harness, signIn } from './harness.ts'

const PASSWORD = 'a-long-enough-password'

async function anOwner(instance: Harness, email = 'owner@example.test') {
  await instance.auth.api.signUpEmail({ body: { name: 'Ada', email, password: PASSWORD } })
  return email
}

describe('open mode', () => {
  it('makes every request the local operator, holding everything', async () => {
    const open = await harness()
    const principal = await open.resolver.fromHeaders(new Headers())
    expect(principal).toMatchObject({ kind: 'local', role: 'owner', scope: 'all', actor: 'local', actorKind: 'human' })
    expect(principal!.permissions.size).toBe(PERMISSIONS.length)
  })

  // The header is attribution, and the one thing it decides: a request that
  // says it is an agent is held to what agents may do.
  it('narrows a request that announces itself as an agent', async () => {
    const open = await harness()
    const principal = await open.resolver.fromHeaders(new Headers({ 'x-portta-actor': 'claude-code' }))
    expect(principal).toMatchObject({ actor: 'claude-code', actorKind: 'agent' })
    expect(principal!.permissions.has('issue:write')).toBe(true)
    expect(principal!.permissions.has('environment:settings')).toBe(false)
    expect(principal!.permissions.size).toBe(AGENT_DEFAULT_PERMISSIONS.length)
  })

  it('honours an actor that says it is a person', async () => {
    const open = await harness()
    const principal = await open.resolver.fromHeaders(
      new Headers({ 'x-portta-actor': 'fabio', 'x-portta-actor-kind': 'human' }),
    )
    expect(principal).toMatchObject({ actor: 'fabio', actorKind: 'human' })
    expect(principal!.permissions.size).toBe(PERMISSIONS.length)
  })

  it('ignores an actor name that is not one', async () => {
    const open = await harness()
    const principal = await open.resolver.fromHeaders(new Headers({ 'x-portta-actor': 'rm -rf /' }))
    expect(principal!.actor).toBe('local')
  })

  it('takes what the operator granted agents, when they narrowed it', async () => {
    const open = await harness({ agentPermissions: ['issue:read', 'logs:read'] })
    const principal = await open.resolver.fromHeaders(new Headers({ 'x-portta-actor': 'claude-code' }))
    expect([...principal!.permissions].sort()).toEqual(['issue:read', 'logs:read'])
  })

  it('leaves only reads in read-only mode', async () => {
    const open = await harness({ readOnly: true })
    const principal = await open.resolver.fromHeaders(new Headers())
    expect(principal!.permissions.size).toBe(READ_PERMISSIONS.length)
    expect(principal!.permissions.has('issue:write')).toBe(false)
  })
})

describe('protected mode', () => {
  it('answers nothing to a request with no credential', async () => {
    const open = await harness({ mode: 'protected' })
    expect(await open.resolver.fromHeaders(new Headers())).toBeNull()
  })

  it('makes the first user the owner, and their cookie a principal', async () => {
    const open = await harness({ mode: 'protected' })
    const email = await anOwner(open)
    const principal = await open.resolver.fromHeaders(await signIn(open.auth, email, PASSWORD))

    expect(principal).toMatchObject({ kind: 'user', role: 'owner', email, actorKind: 'human', scope: 'all' })
    expect(principal!.permissions.size).toBe(permissionsOf('owner').size)
    expect(principal!.sessionId).not.toBeNull()
  })

  it('answers nothing to a cookie that is not one', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)
    expect(await open.resolver.fromHeaders(new Headers({ cookie: 'portta.session_token=nonsense' }))).toBeNull()
  })

  // A ban has to take effect on the next request, not on the next sign-in:
  // somebody with an open session is exactly who a ban is for.
  it('answers nothing for a banned user, session or not', async () => {
    const open = await harness({ mode: 'protected' })
    const email = await anOwner(open)
    const headers = await signIn(open.auth, email, PASSWORD)
    expect(await open.resolver.fromHeaders(headers)).not.toBeNull()

    await open.db.update(users).set({ banned: true }).where(eq(users.email, email))
    expect(await open.resolver.fromHeaders(headers)).toBeNull()
  })

  it('leaves only reads in read-only mode, whoever signed in', async () => {
    const open = await harness({ mode: 'protected', readOnly: true })
    const email = await anOwner(open)
    const principal = await open.resolver.fromHeaders(await signIn(open.auth, email, PASSWORD))
    expect(principal!.permissions.has('issue:write')).toBe(false)
    expect(principal!.permissions.has('issue:read')).toBe(true)
  })
})

describe('a token', () => {
  async function aToken(instance: Harness, scopes?: Record<string, string[]>) {
    const email = await anOwner(instance)
    const [user] = await instance.db.select().from(users).where(eq(users.email, email))
    const key = await instance.auth.api.createApiKey({
      body: {
        userId: user!.id,
        name: 'a token',
        prefix: 'ptt_',
        ...(scopes ? { permissions: scopes } : {}),
        metadata: { actor: 'ci', actorKind: 'agent', source: 'api' },
      },
    })
    return { key, user: user! }
  }

  it('is a principal with its owner’s role', async () => {
    const open = await harness({ mode: 'protected' })
    const { key } = await aToken(open)
    const principal = await open.resolver.fromHeaders(bearer(key.key))
    expect(principal).toMatchObject({ kind: 'token', role: 'owner', actor: 'ci', actorKind: 'agent', source: 'api' })
    expect(principal!.tokenId).toBe(key.id)
  })

  // A token never exceeds its owner: the intersection is what makes lowering a
  // role lower every token that leaned on it, without touching the tokens.
  it('holds the intersection of its scopes and its owner’s role', async () => {
    const open = await harness({ mode: 'protected' })
    const { key } = await aToken(open, { issue: ['read', 'write'], logs: ['read'] })
    const principal = await open.resolver.fromHeaders(bearer(key.key))
    expect([...principal!.permissions].sort()).toEqual(['issue:read', 'issue:write', 'logs:read'])
  })

  it('is refused when its owner is banned', async () => {
    const open = await harness({ mode: 'protected' })
    const { key, user } = await aToken(open)
    await open.db.update(users).set({ banned: true }).where(eq(users.id, user.id))
    expect(await open.resolver.fromHeaders(bearer(key.key))).toBeNull()
  })

  it('is refused when it is not one', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)
    expect(await open.resolver.fromHeaders(bearer('ptt_not-a-real-token'))).toBeNull()
    // Not a Portta token at all: the prefix is what scanners look for, and what
    // stops the panel spending a lookup on somebody else's bearer token.
    expect(await open.resolver.fromHeaders(bearer('github_pat_xxx'))).toBeNull()
  })
})
