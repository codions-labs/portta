// The first user, and every door after them.
//
// A self-hosted panel has no invitation mail and no public sign-up: the owner
// is created once by the bootstrap, and everybody else by an administrator.
// These are the tests that keep that shape, because the failure they guard
// against is silent — an open sign-up endpoint on a panel exposed to a network.

import { eq } from 'drizzle-orm'
import { DEV_DEMO_OWNER } from 'portta-core'
import { users } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { bootstrapOwner, hasOwner, SetupClosed, setupStatus } from '../src/bootstrap.ts'
import { type Harness, harness, signIn } from './harness.ts'

const PASSWORD = 'a-long-enough-password'

function anOwner(instance: Harness, email = 'owner@example.test') {
  return bootstrapOwner(instance.authFor, instance.db, { name: 'Ada', email, password: PASSWORD }, new Headers())
}

describe('the setup status', () => {
  it('asks for a setup while there is no owner, and stops once there is', async () => {
    const open = await harness({ mode: 'protected' })
    expect(await setupStatus(open.db, 'protected')).toMatchObject({ setupRequired: true })

    await anOwner(open)
    expect(await setupStatus(open.db, 'protected')).toMatchObject({ setupRequired: false, twoFactor: false })
  })
})

describe('the bootstrap', () => {
  // The first user is the owner, and the password has to be hashed the way
  // sign-in hashes it, which is the whole reason the bootstrap goes through
  // Better Auth instead of inserting a row. Real scrypt, here and nowhere else.
  it('leaves an account the owner can sign in with', async () => {
    const open = await harness({ mode: 'protected', realPasswords: true })
    const { user } = await anOwner(open)
    const [row] = await open.db.select().from(users).where(eq(users.id, user.id))
    expect(row).toMatchObject({ email: 'owner@example.test', role: 'owner', banned: false })
    expect(await hasOwner(open.db)).toBe(true)

    const principal = await open.resolver.fromHeaders(await signIn(open.auth, 'owner@example.test', PASSWORD))
    expect(principal).toMatchObject({ role: 'owner', email: 'owner@example.test' })
  })

  it('accepts the well-known demo password on a development panel', async () => {
    const open = await harness({ mode: 'protected', development: true })
    await bootstrapOwner(open.authFor, open.db, { ...DEV_DEMO_OWNER }, new Headers())
    const principal = await open.resolver.fromHeaders(
      await signIn(open.auth, DEV_DEMO_OWNER.email, DEV_DEMO_OWNER.password),
    )
    expect(principal).toMatchObject({
      role: 'owner',
      name: DEV_DEMO_OWNER.name,
      email: DEV_DEMO_OWNER.email,
    })
  })

  it('refuses a second one, so an owner is never replaced by a stranger', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)

    await expect(anOwner(open, 'someone@example.test')).rejects.toBeInstanceOf(SetupClosed)
    await expect(anOwner(open, 'someone@example.test')).rejects.toMatchObject({ status: 409 })
    expect(await open.db.select().from(users)).toHaveLength(1)
  })
})

describe('sign-up, from outside', () => {
  async function signUp(instance: Harness, email: string) {
    return instance.auth.handler(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mallory', email, password: PASSWORD }),
      }),
    )
  }

  // The endpoint is disabled outright: nobody signs themselves up, whether or
  // not this installation already has an owner.
  it('is not an endpoint, owner or no owner', async () => {
    const open = await harness({ mode: 'protected' })
    expect((await signUp(open, 'mallory@example.test')).status).toBeGreaterThanOrEqual(400)

    await anOwner(open)
    expect((await signUp(open, 'mallory@example.test')).status).toBeGreaterThanOrEqual(400)
    expect(await open.db.select().from(users)).toHaveLength(1)
  })

  // And the hook underneath it, which is what a call made inside the panel
  // reaches — `disabledPaths` closes the HTTP route, not `auth.api.*`. The
  // refusal has to be a refusal: 403, not a 200 carrying a user nobody wrote.
  it('is refused by the hook as well, once there is an owner', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)

    await expect(
      open.auth.api.signUpEmail({ body: { name: 'Mallory', email: 'mallory@example.test', password: PASSWORD } }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN', statusCode: 403 })
    expect(await open.db.select().from(users)).toHaveLength(1)
  })
})

describe('an administrator creating a user', () => {
  async function aUser(instance: Harness, headers: Headers, email: string, role: string) {
    return instance.auth.api.createUser({
      body: { name: 'Grace', email, password: PASSWORD, role: role as 'admin' },
      headers,
    })
  }

  it('works for the owner, and takes the role they asked for', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)
    const headers = await signIn(open.auth, 'owner@example.test', PASSWORD)

    await aUser(open, headers, 'grace@example.test', 'developer')
    const [row] = await open.db.select().from(users).where(eq(users.email, 'grace@example.test'))
    expect(row).toMatchObject({ role: 'developer' })
  })

  it('works for an admin', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)
    const asOwner = await signIn(open.auth, 'owner@example.test', PASSWORD)
    await aUser(open, asOwner, 'admin@example.test', 'admin')

    const asAdmin = await signIn(open.auth, 'admin@example.test', PASSWORD)
    await aUser(open, asAdmin, 'grace@example.test', 'viewer')
    const [row] = await open.db.select().from(users).where(eq(users.email, 'grace@example.test'))
    expect(row).toMatchObject({ role: 'viewer' })
  })

  // A developer holds `issue:write`, not `user:create`. Creating accounts is the
  // one thing that lets somebody escalate themselves, so it stays with the two
  // administrative roles.
  it('is refused to a developer', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)
    const asOwner = await signIn(open.auth, 'owner@example.test', PASSWORD)
    await aUser(open, asOwner, 'dev@example.test', 'developer')

    const asDeveloper = await signIn(open.auth, 'dev@example.test', PASSWORD)
    await expect(aUser(open, asDeveloper, 'mallory@example.test', 'admin')).rejects.toBeDefined()
    expect(await open.db.select().from(users).where(eq(users.email, 'mallory@example.test'))).toHaveLength(0)
  })

  it('is refused to nobody at all', async () => {
    const open = await harness({ mode: 'protected' })
    await anOwner(open)
    await expect(aUser(open, new Headers(), 'mallory@example.test', 'admin')).rejects.toBeDefined()
  })
})
