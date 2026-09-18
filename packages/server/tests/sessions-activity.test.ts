// Sessions and activity: who is working on what, and what happened.

import { projectEnvironments, projects as projectsTable } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { databasePerFile, makeApp, post } from './helpers.ts'

const seededDatabase = databasePerFile()

const ISSUE = 'github:acme/api#113'
const OTHER_ISSUE = 'github:acme/api#114'

/** A Project that has adopted `alpha`, and a second Project to be refused from. */
async function work() {
  const seeded = await seededDatabase()
  await seeded.db.insert(projectEnvironments).values({
    projectId: Number(seeded.ids.project),
    environmentId: Number(seeded.ids.environment),
    source: 'manual',
  })
  const [other] = await seeded.db
    .insert(projectsTable)
    .values({ slug: 'outro', name: 'Outro' })
    .returning({ id: projectsTable.id })

  return {
    db: seeded.database,
    ids: { ...seeded.ids, other: String(other!.id) },
    activity: seeded.database.activity,
  }
}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

describe('sessions', () => {
  it('starts, heartbeats and ends a session, as the agent that announced itself', async () => {
    const { db, activity } = await work()
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const started = await post(
      app,
      '/api/projects/produto/sessions',
      { issueRef: ISSUE, environment: 'alpha', summary: 'auth fix' },
      { 'X-Portta-Actor': 'claude-code' },
    )
    expect(started.status).toBe(201)
    const session = await json(started)
    expect(session).toMatchObject({
      actor: 'claude-code',
      actorKind: 'agent',
      agent: 'claude-code',
      status: 'active',
      issueRef: ISSUE,
      environment: 'alpha',
      project: 'produto',
    })
    expect((await activity.list())[0]).toMatchObject({
      kind: 'session.started',
      sessionId: session.id,
      issueRef: ISSUE,
    })

    const beat = await app.request(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ heartbeat: true }),
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        host: 'localhost',
        'X-Portta-Actor': 'claude-code',
      },
    })
    expect((await json(beat)).status).toBe('active')

    const denied = await app.request(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ended' }),
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        host: 'localhost',
        'X-Portta-Actor': 'other-bot',
      },
    })
    expect(denied.status).toBe(403)

    const ended = await app.request(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ended', summary: 'done' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(await json(ended)).toMatchObject({ status: 'ended', summary: 'done' })
    expect(ended.status).toBe(200)
    expect((await activity.list())[0]).toMatchObject({ kind: 'session.ended', sessionId: session.id })
    expect((await json(await app.request('/api/projects/produto/sessions?active=true'))).sessions).toEqual([])
    expect((await json(await app.request('/api/projects/produto/sessions'))).sessions).toHaveLength(1)
  })

  // The ref is recorded as given — the provider is never asked to confirm it,
  // because a session must open with GitHub down. What is still checked is what
  // Portta itself owns: the environment and the repository.
  it('records an issue ref unchecked, and refuses an environment the panel does not know', async () => {
    const { db } = await work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const started = await post(app, '/api/projects/produto/sessions', { issueRef: 'github:somebody/else#9' })
    expect(started.status).toBe(201)
    expect((await json(started)).issueRef).toBe('github:somebody/else#9')

    expect((await post(app, '/api/projects/produto/sessions', { environment: 'ghost' })).status).toBe(400)
    expect((await post(app, '/api/projects/produto/sessions', { issueRef: 'not-a-ref' })).status).toBe(400)
  })

  it('limits the issue workspace to sessions that belong to that issue', async () => {
    const { db } = await work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const first = await json(
      await post(app, '/api/projects/produto/sessions', { issueRef: ISSUE }, { 'X-Portta-Actor': 'claude' }),
    )
    await post(app, '/api/projects/produto/sessions', { issueRef: OTHER_ISSUE }, { 'X-Portta-Actor': 'codex' })

    const listed = await json(
      await app.request(`/api/projects/produto/sessions?issue=${encodeURIComponent(ISSUE)}&active=true`),
    )

    expect(listed.sessions).toEqual([expect.objectContaining({ id: first.id, issueRef: ISSUE })])
  })
})

describe('activity', () => {
  it('lists a Project’s events newest first, with names resolved and filters applied', async () => {
    const { db, ids, activity } = await work()
    await activity.append({
      kind: 'issue.created',
      projectId: ids.project,
      issueRef: ISSUE,
      repositoryId: ids.repository,
      summary: 'created',
    })
    await activity.append({
      kind: 'environment.started',
      projectId: ids.project,
      environmentId: ids.environment,
      summary: 'alpha started',
      actorKind: 'human',
      actor: 'fabio',
    })
    await activity.append({ kind: 'issue.state', projectId: ids.other, summary: 'elsewhere' })
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const events = (await json(await app.request('/api/projects/produto/activity'))).events
    expect(events.map((event: { kind: string }) => event.kind)).toEqual(['environment.started', 'issue.created'])
    expect(events[0]).toMatchObject({ project: 'produto', environment: 'alpha', actor: 'fabio' })
    expect(events[1]).toMatchObject({ issueRef: ISSUE, repositoryName: 'api' })
    expect((await json(await app.request('/api/projects/produto/activity?kind=issue.created'))).events).toHaveLength(1)
    expect(
      (await json(await app.request(`/api/projects/produto/issues/${encodeURIComponent(ISSUE)}/activity`))).events,
    ).toEqual([expect.objectContaining({ kind: 'issue.created', issueRef: ISSUE })])
    expect((await json(await app.request('/api/activity'))).events).toHaveLength(3)
  })

  it('records lifecycle operations on an environment, attributed to the Project that adopted it', async () => {
    const { db, ids, activity } = await work()
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    expect(
      (await post(app, '/api/environments/alpha/actions/stop', {}, { 'X-Portta-Actor': 'claude-code' })).status,
    ).toBe(200)
    expect((await activity.list())[0]).toMatchObject({
      kind: 'environment.stopped',
      actor: 'claude-code',
      actorKind: 'agent',
      projectId: ids.project,
      environmentId: ids.environment,
    })
  })
})
