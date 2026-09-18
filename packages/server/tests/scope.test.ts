// A permission says what somebody may do. A membership says where.
//
// The negatives are the point: a developer holding `issue:write` still gets 403
// in a Project nobody put them in, and every listing answers with theirs rather
// than refusing. What is asserted here per resource is that the second half of
// the decision is actually made — a route that resolved the resource and then
// forgot to ask is exactly what this catches.

import { readFileSync } from 'node:fs'
import type { Hono } from 'hono'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { type Db, environments as environmentsTable, projectEnvironments, projects as projectsTable } from 'portta-db'
import { beforeAll, describe, expect, it } from 'vitest'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { cheapPasswords, makeProtectedApp, type SeededDatabase, seededDatabase, signInAs } from './helpers.ts'

const PASSWORD = 'a-long-enough-password'

let seeded: SeededDatabase
let panel: ReturnType<typeof makeProtectedApp>
let app: Hono
let db: Db
const cookies: Record<string, Record<string, string>> = {}
const ids = { mine: 0, theirs: 0, developer: '' }

const json = (response: Response) => response.json() as Promise<Record<string, any>>

function get(path: string, as: string) {
  return app.request(path, { headers: cookies[as] })
}

function send(method: string, path: string, as: string, body?: unknown) {
  return app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookies[as] },
  })
}

beforeAll(async () => {
  seeded = await seededDatabase()
  // A host with both environments running, so the environment routes have
  // something to answer about rather than 404ing before the scope is reached.
  panel = makeProtectedApp(
    seeded.database,
    {},
    {
      containers: [
        ...GATEWAY,
        ...PROJECT_A,
        {
          id: 'b-web',
          name: 'beta-web-1',
          image: 'nginx:1.31.4-alpine',
          health: 'healthy',
          networks: ['portta', 'beta_default'],
          exposed: [80],
          labels: {
            'com.docker.compose.project': 'beta',
            'com.docker.compose.service': 'web',
            'com.docker.compose.project.working_dir': '/srv/dev/beta',
            'traefik.enable': 'true',
          },
        },
        {
          id: 'o-web',
          name: 'orphan-web-1',
          image: 'nginx:1.31.4-alpine',
          health: 'healthy',
          networks: ['orphan_default'],
          exposed: [80],
          labels: {
            'com.docker.compose.project': 'orphan',
            'com.docker.compose.service': 'web',
            'com.docker.compose.project.working_dir': '/srv/dev/orphan',
          },
        },
      ],
    },
  )
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

  // Two Projects: one the developer is a member of, one they are not. The
  // seeded 'produto' is theirs; a second one is not.
  ids.mine = Number(seeded.ids.project)
  const [other] = await db
    .insert(projectsTable)
    .values({ slug: 'outro', name: 'Outro' })
    .returning({ id: projectsTable.id })
  ids.theirs = other!.id

  // One environment each, adopted, so the environment routes have both cases.
  const [beta] = await db
    .insert(environmentsTable)
    .values({ composeProject: 'beta' })
    .returning({ id: environmentsTable.id })
  await db.insert(projectEnvironments).values([
    { projectId: ids.mine, environmentId: Number(seeded.ids.environment), source: 'manual' },
    { projectId: ids.theirs, environmentId: beta!.id, source: 'manual' },
  ])

  const created = await json(
    await send('POST', '/api/users', 'owner', {
      name: 'Grace',
      email: 'dev@example.test',
      password: PASSWORD,
      role: 'developer',
    }),
  )
  ids.developer = created.id
  await send('PUT', `/api/users/${created.id}/projects`, 'owner', { projects: [ids.mine] })
  cookies.dev = await signInAs(panel.auth, 'dev@example.test', PASSWORD)
})

describe('a named resource in a Project somebody is not in', () => {
  // Refused before the Project's own configuration is read, so a non-member
  // cannot learn from a 409 whether it is linked to a provider at all.
  it('is refused for the issues of a Project, read and written alike', async () => {
    expect((await get('/api/projects/outro/issues', 'dev')).status).toBe(403)
    expect((await get('/api/projects/outro/issues/1', 'dev')).status).toBe(403)
    expect((await get('/api/projects/outro/issues-vocabulary', 'dev')).status).toBe(403)
    expect((await send('POST', '/api/projects/outro/issues', 'dev', { title: 'no' })).status).toBe(403)
    expect((await send('PATCH', '/api/projects/outro/issues/1', 'dev', { title: 'no' })).status).toBe(403)
    expect((await send('POST', '/api/projects/outro/issues/1/comments', 'dev', { body: 'no' })).status).toBe(403)
  })

  it('is refused for a session in it, by id', async () => {
    const started = await json(
      await send('POST', '/api/projects/outro/sessions', 'owner', { issueRef: 'github:acme/beta#7' }),
    )
    expect((await get(`/api/sessions/${started.id}`, 'dev')).status).toBe(403)
    expect((await send('PATCH', `/api/sessions/${started.id}`, 'dev', { heartbeat: true })).status).toBe(403)
    expect((await get(`/api/sessions/${started.id}`, 'owner')).status).toBe(200)
  })

  it('is allowed in the Project they are in', async () => {
    expect((await get('/api/projects/produto', 'dev')).status).toBe(200)
    expect((await get('/api/projects/produto/sessions', 'dev')).status).toBe(200)
    expect((await get('/api/environments/alpha/settings', 'dev')).status).toBe(200)
  })

  // An environment nothing adopted has no membership to check, so it belongs to
  // whoever sees everything and to nobody else.
  it('refuses an unadopted environment to a developer, and answers the owner', async () => {
    expect((await get('/api/environments/orphan/settings', 'dev')).status).toBe(403)
    expect((await get('/api/environments/orphan/settings', 'owner')).status).toBe(200)
  })
})

describe('a listing', () => {
  it('answers with theirs rather than refusing', async () => {
    const projects = await json(await get('/api/projects', 'dev'))
    expect(projects.projects.map((project: { slug: string }) => project.slug)).toEqual(['produto'])

    // Activity crosses every Project, so the filter is the only thing keeping
    // one Project's work out of another member's list.
    await send('POST', '/api/projects/produto/sessions', 'owner', { summary: 'mine' })
    await send('POST', '/api/projects/outro/sessions', 'owner', { summary: 'theirs' })
    const activity = await json(await get('/api/activity', 'dev'))
    expect(activity.events.map((event: { project: string | null }) => event.project)).toEqual(['produto'])
  })

  it('shows the owner everything', async () => {
    const projects = await json(await get('/api/projects', 'owner'))
    expect(projects.projects.map((project: { slug: string }) => project.slug).sort()).toEqual(['outro', 'produto'])
  })

  it('sums only the visible on the Overview', async () => {
    const overview = await json(await get('/api/overview', 'dev'))
    expect(overview.projects.map((project: { slug: string }) => project.slug)).toEqual(['produto'])
  })
})

describe('losing a membership', () => {
  it('closes the door on the next request, with no sign-in in between', async () => {
    expect((await get('/api/projects/produto', 'dev')).status).toBe(200)
    await send('PUT', `/api/users/${ids.developer}/projects`, 'owner', { projects: [] })
    expect((await get('/api/projects/produto', 'dev')).status).toBe(403)
    await send('PUT', `/api/users/${ids.developer}/projects`, 'owner', { projects: [ids.mine] })
  })
})

describe('what /api/auth/me says', () => {
  it('names the Projects this request can open', async () => {
    const me = await json(await get('/api/auth/me', 'dev'))
    expect(me).toMatchObject({ role: 'developer' })
    expect(me.projects.map((project: { slug: string }) => project.slug)).toEqual(['produto'])
    expect(me.scope).toEqual([ids.mine])

    const owner = await json(await get('/api/auth/me', 'owner'))
    expect(owner.scope).toBe('all')
    expect(owner.projects).toHaveLength(2)
  })
})

// The coverage check: every documented read whose path names a Project or an
// environment, driven at a Project this caller is not in. A route that resolves
// its resource and forgets to ask about the scope answers 200 here, and this is
// the only thing that would notice.
describe('every documented read that names a Project', () => {
  const FILL: Record<string, string> = {
    '{slug}': 'outro',
    '{project}': 'beta',
    '{service}': 'web',
    // An issue key the provider is never asked for: the scope is decided first.
    '{key}': '1',
    '{ref}': encodeURIComponent('github:acme/beta#7'),
  }

  it('is refused to somebody who is not in it', async () => {
    const document = JSON.parse(
      readFileSync(new URL(import.meta.resolve('portta-contracts/openapi.json')), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> }

    const checked: string[] = []
    for (const [path, item] of Object.entries(document.paths)) {
      if (!('get' in item)) continue
      // Only the paths that name one: a global read has no scope to narrow.
      if (!path.includes('{slug}') && !path.includes('{project}')) continue
      // `{id}` is a container or a share on this fixture, addressed by an id
      // this suite does not mint. Those have their own assertions above.
      if (path.includes('{id}')) continue

      let filled = path
      for (const [token, value] of Object.entries(FILL)) filled = filled.replaceAll(token, value)
      if (filled.includes('{')) continue

      const response = await get(`/api${filled}`, 'dev')
      checked.push(`${filled} -> ${response.status}`)
      expect(response.status, `GET /api${filled}`).toBe(403)
    }

    // A guard on the guard: an empty sweep would pass silently.
    expect(checked.length, checked.join('\n')).toBeGreaterThan(8)
  })
})
