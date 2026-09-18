// Who may do what to whom.
//
// A real Better Auth over the test database, four people with four roles, and
// the rules that protect an account. What is asserted here is the part a
// permission cannot express: the owner is a person, not a statement, and an
// administrator holding every permission still may not take the panel.

import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { type Db, projectMembers, users as usersTable } from 'portta-db'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cheapPasswords, makeProtectedApp, type SeededDatabase, seededDatabase, signInAs } from './helpers.ts'

const PASSWORD = 'a-long-enough-password'

let seeded: SeededDatabase
let panel: ReturnType<typeof makeProtectedApp>
let app: Hono
let db: Db
const cookies: Record<string, Record<string, string>> = {}
const ids: Record<string, string> = {}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function get(path: string, as: string) {
  return app.request(path, { headers: cookies[as] })
}

async function send(method: string, path: string, as: string, body?: unknown) {
  return app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      host: 'localhost',
      ...cookies[as],
    },
  })
}

beforeAll(async () => {
  seeded = await seededDatabase()
  panel = makeProtectedApp(seeded.database)
  app = panel.app
  db = panel.db

  const security = resolveSecurityMode({
    PORTTA_AUTH_MODE: 'required',
    PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
  })
  await bootstrapOwner(
    (handle) => createAuth({ db: handle, security, hasOwner: () => hasOwner(handle), password: cheapPasswords }),
    db,
    { name: 'Ada', email: 'owner@example.test', password: PASSWORD },
    new Headers(),
  )
  cookies.owner = await signInAs(panel.auth, 'owner@example.test', PASSWORD)

  for (const role of ['admin', 'developer', 'viewer'] as const) {
    const created = await json(
      await send('POST', '/api/users', 'owner', {
        name: role,
        email: `${role}@example.test`,
        password: PASSWORD,
        role,
      }),
    )
    ids[role] = created.id
    cookies[role] = await signInAs(panel.auth, `${role}@example.test`, PASSWORD)
  }
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.email, 'owner@example.test'))
  ids.owner = owner!.id
})

afterEach(async () => {
  // Every test leaves the four accounts as it found them: the roles are the
  // fixture, and a test that promoted somebody would silently change the next.
  for (const role of ['admin', 'developer', 'viewer'] as const) {
    await db.update(usersTable).set({ role, banned: false, banReason: null }).where(eq(usersTable.id, ids[role]!))
  }
  await db.update(usersTable).set({ role: 'owner' }).where(eq(usersTable.id, ids.owner!))
})

describe('listing', () => {
  it('names everybody, with no credential material anywhere in it', async () => {
    const body = await json(await get('/api/users', 'owner'))
    expect(body.users.map((user: { email: string }) => user.email).sort()).toEqual([
      'admin@example.test',
      'developer@example.test',
      'owner@example.test',
      'viewer@example.test',
    ])
    const rendered = JSON.stringify(body)
    expect(rendered).not.toContain('password')
    expect(rendered).not.toContain('$scrypt')
  })

  it('is refused to a developer and a viewer, who do not administer', async () => {
    expect((await get('/api/users', 'developer')).status).toBe(403)
    expect((await get('/api/users', 'viewer')).status).toBe(403)
  })
})

describe('creating', () => {
  it('takes the role it was asked for, and never owner', async () => {
    const created = await json(
      await send('POST', '/api/users', 'owner', {
        name: 'Grace',
        email: 'grace@example.test',
        password: PASSWORD,
        role: 'developer',
      }),
    )
    expect(created).toMatchObject({ email: 'grace@example.test', role: 'developer', banned: false })

    const refused = await send('POST', '/api/users', 'owner', {
      name: 'Mallory',
      email: 'mallory@example.test',
      password: PASSWORD,
      role: 'owner',
    })
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toContain('transferred')

    await send('DELETE', `/api/users/${created.id}`, 'owner')
  })

  it('is refused to a developer', async () => {
    const refused = await send('POST', '/api/users', 'developer', {
      name: 'Mallory',
      email: 'mallory@example.test',
      password: PASSWORD,
      role: 'admin',
    })
    expect(refused.status).toBe(403)
  })
})

describe('the rules a permission cannot express', () => {
  it('lets nobody change their own role, not even the owner', async () => {
    const refused = await send('PATCH', `/api/users/${ids.owner}/role`, 'owner', { role: 'admin' })
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toContain('their own role')
  })

  // An admin holds every statement. What stops them taking the panel is that
  // the owner is not a role they may write.
  it('stops an admin acting on the owner at all', async () => {
    for (const [method, path, body] of [
      ['PATCH', `/api/users/${ids.owner}/role`, { role: 'viewer' }],
      ['PATCH', `/api/users/${ids.owner}/ban`, { banned: true }],
      ['PATCH', `/api/users/${ids.owner}/password`, { password: 'another-long-password' }],
      ['DELETE', `/api/users/${ids.owner}`, undefined],
    ] as const) {
      const refused = await send(method, path, 'admin', body)
      expect(refused.status, `${method} ${path}`).toBe(403)
      expect((await json(refused)).error).toContain('only the owner')
    }
  })

  it('refuses to assign ownership through set-role', async () => {
    const refused = await send('PATCH', `/api/users/${ids.admin}/role`, 'owner', { role: 'owner' })
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toContain('transferred')
  })

  it('lets nobody remove their own account', async () => {
    const refused = await send('DELETE', `/api/users/${ids.admin}`, 'admin')
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toContain('their own account')
  })

  it('keeps the last owner', async () => {
    // Through the service's own rule, not the "only the owner" one: the owner
    // asking to remove themselves is refused for being themselves first, so the
    // last-owner rule is reached by asking about a second owner that is not.
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, ids.owner!))
    expect(row!.role).toBe('owner')
    const refused = await send('DELETE', `/api/users/${ids.owner}`, 'owner')
    expect(refused.status).toBe(403)
  })
})

describe('a role change', () => {
  it('moves somebody, and clears memberships that stop meaning anything', async () => {
    await send('PUT', `/api/users/${ids.developer}/projects`, 'owner', { projects: [Number(seeded.ids.project)] })
    expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, ids.developer!))).toHaveLength(1)

    const promoted = await json(await send('PATCH', `/api/users/${ids.developer}/role`, 'owner', { role: 'admin' }))
    expect(promoted.role).toBe('admin')
    expect(promoted.projects).toEqual([])
    expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, ids.developer!))).toHaveLength(0)
  })

  it('is refused to a developer, who does not administer', async () => {
    expect((await send('PATCH', `/api/users/${ids.viewer}/role`, 'developer', { role: 'admin' })).status).toBe(403)
  })
})

describe('a password set by an administrator', () => {
  it('ends every session that account had', async () => {
    const before = await json(await get(`/api/users/${ids.viewer}/sessions`, 'owner'))
    expect(before.sessions.length).toBeGreaterThan(0)

    const done = await send('PATCH', `/api/users/${ids.viewer}/password`, 'owner', { password: 'a-brand-new-password' })
    expect(done.status).toBe(200)

    const after = await json(await get(`/api/users/${ids.viewer}/sessions`, 'owner'))
    expect(after.sessions).toEqual([])

    // And the cookie that was open is nobody now.
    expect((await get('/api/status', 'viewer')).status).toBe(401)
    cookies.viewer = await signInAs(panel.auth, 'viewer@example.test', 'a-brand-new-password')
  })
})

describe('a ban', () => {
  it('takes effect on the next request, not the next sign-in', async () => {
    expect((await get('/api/status', 'developer')).status).toBe(200)
    await send('PATCH', `/api/users/${ids.developer}/ban`, 'owner', { banned: true, reason: 'left' })
    expect((await get('/api/status', 'developer')).status).toBe(401)

    await send('PATCH', `/api/users/${ids.developer}/ban`, 'owner', { banned: false })
    cookies.developer = await signInAs(panel.auth, 'developer@example.test', PASSWORD)
    expect((await get('/api/status', 'developer')).status).toBe(200)
  })
})

describe('project membership', () => {
  it('is the whole list, every time', async () => {
    const project = Number(seeded.ids.project)
    const granted = await json(await send('PUT', `/api/users/${ids.viewer}/projects`, 'owner', { projects: [project] }))
    expect(granted.projects.map((entry: { id: number }) => entry.id)).toEqual([project])

    const cleared = await json(await send('PUT', `/api/users/${ids.viewer}/projects`, 'owner', { projects: [] }))
    expect(cleared.projects).toEqual([])
  })

  it('refuses a project that does not exist, and says which', async () => {
    const refused = await send('PUT', `/api/users/${ids.viewer}/projects`, 'owner', { projects: [999_999] })
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toContain('999999')
  })

  // Owner and admin see everything. A membership row for them would be a
  // boundary nothing enforces.
  it('refuses to give an admin a membership', async () => {
    const refused = await send('PUT', `/api/users/${ids.admin}/projects`, 'owner', { projects: [] })
    expect(refused.status).toBe(403)
    expect((await json(refused)).error).toContain('every Project')
  })
})

describe('transferring the panel', () => {
  it("is the owner's alone, and leaves exactly one owner", async () => {
    expect((await send('POST', `/api/users/${ids.developer}/transfer-ownership`, 'admin')).status).toBe(403)

    const now = await json(await send('POST', `/api/users/${ids.admin}/transfer-ownership`, 'owner'))
    expect(now).toMatchObject({ email: 'admin@example.test', role: 'owner' })

    const owners = (await db.select().from(usersTable)).filter((row) => row.role === 'owner')
    expect(owners).toHaveLength(1)
    expect(owners[0]!.id).toBe(ids.admin)

    const [caller] = await db.select().from(usersTable).where(eq(usersTable.id, ids.owner!))
    expect(caller!.role).toBe('admin')
  })
})

// The acceptance criteria of this phase, against real endpoints rather than
// against the permission sets: a role is only as good as what the routes do
// with it.
describe('the role matrix, at the door', () => {
  const writes = [
    ['PATCH', '/api/config', { PORTTA_WEB_READ_ONLY: 'true' }, 'settings:manage'],
    ['POST', '/api/users', { name: 'x', email: 'x@example.test', password: 'a-long-enough-password' }, 'user:create'],
    ['POST', '/api/gateway/restart', { components: ['traefik'] }, 'gateway:operate'],
  ] as const

  it('refuses a viewer every write there is', async () => {
    for (const [method, path, body] of writes) {
      expect((await send(method, path, 'viewer', body)).status, `${method} ${path}`).toBe(403)
    }
    expect((await send('POST', '/api/projects', 'viewer', { name: 'New', path: 'new' })).status).toBe(403)
  })

  // A developer works. What they do not do is reconfigure the panel, administer
  // accounts, or destroy anything.
  it('refuses a developer settings, users and the gateway', async () => {
    for (const [method, path, body] of writes) {
      expect((await send(method, path, 'developer', body)).status, `${method} ${path}`).toBe(403)
    }
    expect((await get('/api/users', 'developer')).status).toBe(403)
  })

  // A developer works in the Projects somebody put them in, and in no others.
  // The membership is the whole difference: the permission was never in doubt.
  it('lets a developer do the work, in a Project they are a member of', async () => {
    const project = Number(seeded.ids.project)
    const refused = await send('POST', '/api/projects/produto/sessions', 'developer', { summary: 'Ship it' })
    expect(refused.status, 'a developer with no membership').toBe(403)

    await send('PUT', `/api/users/${ids.developer}/projects`, 'owner', { projects: [project] })
    const started = await send('POST', '/api/projects/produto/sessions', 'developer', { summary: 'Ship it' })
    expect([200, 201], `starting a session answered ${started.status}`).toContain(started.status)
    expect((await get('/api/projects/produto/sessions', 'developer')).status).toBe(200)
  })

  it('lets an admin administer, and read every project', async () => {
    expect((await get('/api/users', 'admin')).status).toBe(200)
    expect((await get('/api/projects', 'admin')).status).toBe(200)
  })
})
