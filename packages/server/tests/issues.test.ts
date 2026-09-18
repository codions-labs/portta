// The issue endpoints: live reads and writes against whatever provider a
// Project's work lives in.
//
// Nothing is stored, so what these assert is the boundary: which coordinate the
// panel resolved before it called, what a provider failure becomes as an HTTP
// answer, and what Portta records and adds on its own. The projection itself is
// `issue-view.test.ts`; the Project scope is `scope.test.ts`, where the panel
// runs with authentication on.

import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { Issue, IssueSummary } from 'portta-contracts'
import { environmentIssues, projects as projectsTable, repositories as repositoriesTable } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { type ForgeFailure, type ForgeRequest, ForgeUnavailable } from '../src/services/issues/host-client.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { databasePerFile, fakeForge, makeApp, post, type SeededDatabase } from './helpers.ts'

const seededDatabase = databasePerFile()

const GH_ISSUE = {
  number: 113,
  title: 'Proxy TCP loses the connection',
  state: 'open',
  body: 'it drops after a minute',
  author: { login: 'ada' },
  assignees: [],
  labels: [],
  milestone: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  url: 'https://github.com/acme/api/issues/113',
}

const LINEAR_ISSUE = {
  id: 'uuid',
  identifier: 'ENG-42',
  title: 'Ship the importer',
  description: null,
  url: 'https://linear.app/acme/issue/ENG-42',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  state: { name: 'In Review', type: 'started' },
  assignee: null,
  creator: null,
}

/** A daemon that answers for both providers, and records what it was asked. */
function daemon(overrides: (request: ForgeRequest) => unknown = () => undefined) {
  return fakeForge((request) => {
    const answer = overrides(request)
    if (answer !== undefined) return answer
    if (request.path === '/status') {
      return {
        github: { available: true, authenticated: true, account: 'ada', detail: null },
        linear: { available: false, authenticated: false, account: null, detail: 'no LINEAR_API_KEY' },
      }
    }
    if (request.path === '/issues' && request.method === 'POST') return { ...GH_ISSUE, comments: [] }
    if (request.path === '/issues') return [GH_ISSUE]
    if (request.path === '/issues/113') return { ...GH_ISSUE, comments: [] }
    if (request.path === '/vocabulary')
      return { labels: [{ name: 'bug' }], assignees: [{ login: 'ada' }], milestones: [] }
    if (request.path.startsWith('/linear/issues/')) return LINEAR_ISSUE
    if (request.path === '/linear/issues') return request.method === 'POST' ? LINEAR_ISSUE : [LINEAR_ISSUE]
    return undefined
  })
}

interface Options {
  /** Answers the daemon gives before the defaults; `undefined` falls through. */
  forge?: (request: ForgeRequest) => unknown
  /** Drop the seeded repository, so the Project is linked to nowhere. */
  unlinked?: boolean
  /** Put the Project on Linear instead, with a team. */
  linear?: boolean
  containers?: typeof PROJECT_A
}

async function panel(options: Options = {}) {
  const seeded: SeededDatabase = await seededDatabase()
  if (options.unlinked) {
    await seeded.db.delete(repositoriesTable).where(eq(repositoriesTable.projectId, Number(seeded.ids.project)))
  }
  if (options.linear) {
    await seeded.db
      .update(projectsTable)
      .set({ taskProvider: 'linear', linearTeam: 'ENG' })
      .where(eq(projectsTable.id, Number(seeded.ids.project)))
  }
  const forge = daemon(options.forge)
  return {
    ...makeApp({ containers: [...GATEWAY, ...(options.containers ?? PROJECT_A)] }, {}, seeded.database, forge.client),
    seeded,
    forge,
  }
}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

async function write(app: Hono, method: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('reading a Project’s issues', () => {
  it('resolves the repository from the Project and asks the daemon for it', async () => {
    const { app, forge } = await panel()
    const body = await json(await app.request('/api/projects/produto/issues?state=closed&label=bug'))
    expect((body.issues as IssueSummary[]).map((issue) => issue.ref)).toEqual(['github:acme/api#113'])
    expect(forge.calls[0]).toMatchObject({
      path: '/issues',
      query: { repo: 'acme/api', state: 'closed', label: 'bug' },
    })
  })

  // Through the API, not through the row. Choosing Linear and naming its team
  // are one decision an operator makes on the settings page, and for a while
  // the column existed with no route that could write it — so a Project could
  // be put on Linear and then refuse every read, telling the operator to set a
  // team they had no way to set.
  it('is chosen through the API, team and all, and then answers from it', async () => {
    const { app, forge } = await panel()
    const patched = await write(app, 'PATCH', '/api/projects/produto', { taskProvider: 'linear', linearTeam: 'eng' })
    expect(patched.status).toBe(200)
    const project = await json(patched)
    expect(project.taskProvider).toBe('linear')
    // Uppercased on the way in: Linear returns it that way, and a team that
    // differed only in case would address nothing.
    expect(project.linearTeam).toBe('ENG')

    // The full Project resolves the coordinate; the summary only carries what
    // was chosen.
    const full = await json(await app.request('/api/projects/produto'))
    expect(full.work).toMatchObject({ provider: 'linear', coordinate: 'ENG', reason: null })

    const body = await json(await app.request('/api/projects/produto/issues'))
    expect((body.issues as IssueSummary[]).map((issue) => issue.ref)).toEqual(['linear:ENG-42'])
    expect(forge.calls.at(-1)).toMatchObject({ path: '/linear/issues', query: { team: 'ENG' } })
  })

  // Linear with no team names nothing, and the refusal says which half is
  // missing rather than "not linked".
  it('refuses a Project put on Linear with no team', async () => {
    const { app } = await panel()
    await write(app, 'PATCH', '/api/projects/produto', { taskProvider: 'linear' })
    const response = await app.request('/api/projects/produto/issues')
    expect(response.status).toBe(409)
    expect((await json(response)).error).toContain('names no team')
  })

  it('asks Linear by team when that is where the Project’s work lives', async () => {
    const { app, forge } = await panel({ linear: true })
    const body = await json(await app.request('/api/projects/produto/issues'))
    expect((body.issues as IssueSummary[]).map((issue) => issue.ref)).toEqual(['linear:ENG-42'])
    expect(forge.calls[0]).toMatchObject({ path: '/linear/issues', query: { team: 'ENG' } })
  })

  // Answering an empty list would read as "nothing to do" for a Project that
  // was never linked to anywhere its work could be.
  it('refuses a Project linked to nowhere, and says how to fix it', async () => {
    const { app, forge } = await panel({ unlinked: true })
    const response = await app.request('/api/projects/produto/issues')
    expect(response.status).toBe(409)
    expect((await json(response)).error).toContain('not linked')
    expect(forge.calls).toEqual([])
  })

  it('404s a Project that does not exist', async () => {
    const { app } = await panel()
    expect((await app.request('/api/projects/ghost/issues')).status).toBe(404)
  })

  // Fetched rather than guessed: an assignee the provider does not recognise is
  // a refused write, and a picker that offered it is the reason.
  it('offers the provider’s own vocabulary, and nothing at all on Linear', async () => {
    const { app } = await panel()
    const vocabulary = (await json(await app.request('/api/projects/produto/issues-vocabulary'))).vocabulary
    expect(vocabulary.labels).toEqual([{ name: 'bug', color: null, description: null }])

    const { app: linear } = await panel({ linear: true })
    expect((await json(await linear.request('/api/projects/produto/issues-vocabulary'))).vocabulary).toEqual({
      labels: [],
      assignees: [],
      milestones: [],
    })
  })
})

// `gh` missing, nobody signed in, a rate limit and a repository the account
// cannot see are four different things an operator fixes four different ways.
// A client that saw one status for all of them could only say "it broke".
describe('a provider failure', () => {
  const cases: Array<[ForgeFailure, number]> = [
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['not-found', 404],
    ['rate-limited', 429],
    ['timeout', 504],
    ['failed', 502],
    ['unavailable', 503],
    ['daemon-unreachable', 503],
  ]

  it('keeps its own meaning all the way to the browser', async () => {
    for (const [kind, status] of cases) {
      const { app } = await panel({
        forge: (request) => {
          if (request.path === '/status') return undefined
          throw new ForgeUnavailable(kind, `the provider said ${kind}`, 'do the thing')
        },
      })
      const response = await app.request('/api/projects/produto/issues')
      expect(response.status, kind).toBe(status)
      expect((await json(response)).error, kind).toContain('do the thing')
    }
  })

  // A diagnostic that fails is a diagnostic nobody can read.
  it('is still reported by the status route rather than thrown', async () => {
    const { app } = await panel({
      forge: () => {
        throw new ForgeUnavailable('daemon-unreachable', 'the host daemon is not reachable')
      },
    })
    const response = await app.request('/api/issues/status')
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({
      github: { available: false, authenticated: false, reason: 'the host daemon is not reachable' },
    })
  })
})

describe('writing to a provider', () => {
  it('opens an issue, records it as activity and answers 201', async () => {
    const { app, seeded, forge } = await panel()
    const response = await post(
      app,
      '/api/projects/produto/issues',
      { title: 'Proxy TCP loses the connection', labels: ['bug'] },
      { 'X-Portta-Actor': 'claude' },
    )
    expect(response.status).toBe(201)
    expect((await json(response)).issue.ref).toBe('github:acme/api#113')
    expect(
      forge.calls.some((call) => call.path === '/issues' && call.method === 'POST' && call.query?.repo === 'acme/api'),
    ).toBe(true)

    const [event] = await seeded.database.activity.list()
    expect(event).toMatchObject({ kind: 'issue.created', issueRef: 'github:acme/api#113', actor: 'claude' })
  })

  // Closing and reopening is a different thing to happen than an edit, and the
  // timeline is what somebody reads to find out which one it was.
  it('separates a state change from an edit in the record', async () => {
    const { app, seeded } = await panel()
    expect((await write(app, 'PATCH', '/api/projects/produto/issues/113', { state: 'closed' })).status).toBe(200)
    expect((await seeded.database.activity.list())[0]).toMatchObject({
      kind: 'issue.state',
      issueRef: 'github:acme/api#113',
    })

    expect((await write(app, 'PATCH', '/api/projects/produto/issues/113', { title: 'Renamed' })).status).toBe(200)
    expect((await seeded.database.activity.list())[0]).toMatchObject({ kind: 'issue.updated' })
  })

  it('comments, and records that too', async () => {
    const { app, seeded, forge } = await panel()
    const response = await post(app, '/api/projects/produto/issues/113/comments', { body: 'reproduced here' })
    expect(response.status).toBe(201)
    expect(forge.calls.some((call) => call.path === '/issues/113/comments' && call.method === 'POST')).toBe(true)
    expect((await seeded.database.activity.list())[0]).toMatchObject({
      kind: 'issue.comment',
      issueRef: 'github:acme/api#113',
    })
  })

  it('refuses a body the provider would refuse, before calling it', async () => {
    const { app, forge } = await panel()
    expect((await post(app, '/api/projects/produto/issues', { title: '   ' })).status).toBe(400)
    expect(forge.calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

// The one thing neither provider knows: which environments are running for this
// issue, and why Portta thinks so.
describe('what Portta adds to an issue the provider answered', () => {
  it('names the environments running for it, with the reason', async () => {
    const labelled = PROJECT_A.map((container) => ({
      ...container,
      labels: { ...container.labels, 'portta.issue': 'github:acme/api#113' },
    }))
    const { app } = await panel({ containers: labelled })
    const issue = (await json(await app.request('/api/projects/produto/issues/113'))).issue as Issue
    expect(issue.environments).toEqual([
      expect.objectContaining({
        environment: 'alpha',
        source: 'label',
        reason: 'this environment declares portta.issue',
      }),
    ])
  })

  it('prefers a link somebody stored by hand over what the environment declares', async () => {
    const labelled = PROJECT_A.map((container) => ({
      ...container,
      labels: { ...container.labels, 'portta.issue': 'github:acme/api#999' },
    }))
    const instance = await panel({ containers: labelled })
    await instance.seeded.db.insert(environmentIssues).values({
      environmentId: Number(instance.seeded.ids.environment),
      issueRef: 'github:acme/api#113',
      source: 'manual',
    })
    const issue = (await json(await instance.app.request('/api/projects/produto/issues/113'))).issue as Issue
    expect(issue.environments).toEqual([
      expect.objectContaining({ environment: 'alpha', source: 'manual', reason: 'linked by hand' }),
    ])
  })

  it('answers empty worktrees when Taskflow is not mounted, and refuses to start a Run', async () => {
    const { app } = await panel()
    const issue = (await json(await app.request('/api/projects/produto/issues/113'))).issue as Issue
    expect(issue.worktrees).toEqual([])

    const context = (await json(await app.request('/api/projects/produto/issues/113/run-context'))).context
    expect(context).toMatchObject({ available: false, agents: [] })

    const started = await post(app, '/api/projects/produto/issues/113/runs', { harness: 'codex' })
    expect(started.status).toBe(409)
  })
})
