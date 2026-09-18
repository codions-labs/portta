// The daemon's forge surface: `/api/forge/*`.
//
// Not a module. Modules are optional verticals an operator switches on; reading
// and writing issues is what the panel's work surface *is* now, so it is served
// unconditionally and the panel's proxy is what decides who may call it
// (ADR 0047). What is optional is whether `gh` is installed and signed in, and
// that is reported rather than hidden: `GET /api/forge/status` is the question
// the panel asks before it offers anything.
//
// Every route answers the shapes `gh` produced. The projection into the
// contract happens in the panel, once, so this file never has to know what an
// `IssueSummary` is.

import { Hono } from 'hono'
import { FORGE_STATUS, ForgeError, ghStatus } from './gh.ts'
import {
  assignedIssues,
  commentOnIssue,
  createIssue,
  editIssue,
  type IssueDraft,
  type IssuePatch,
  issueVocabulary,
  listIssues,
  setIssueState,
  viewIssue,
} from './issues.ts'
import {
  commentOnIssue as commentOnLinearIssue,
  createIssue as createLinearIssue,
  editIssue as editLinearIssue,
  linearStatus,
  listTeamIssues,
  teamKeyOf,
  viewIssue as viewLinearIssue,
} from './linear.ts'

/**
 * `owner/name`, and nothing that could become another argument.
 *
 * Every route takes the repository from the query string, and every value goes
 * on to be an argument to `gh`. `execFile` does not use a shell, so this is not
 * about quoting — it is about a value beginning with `-` being read by `gh` as
 * a flag. Anchoring the shape refuses that before it is spawned.
 */
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

function repositoryOf(raw: string | undefined): string {
  const repo = raw?.trim() ?? ''
  if (!REPO.test(repo)) throw new ForgeError('failed', `not a repository: ${repo || '(none)'}`, 'expected owner/name')
  return repo
}

/** `ENG-42`. Same reason as REPO: it becomes a GraphQL variable, and a filter argument. */
const IDENTIFIER = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/

function identifierOf(raw: string | undefined): string {
  const identifier = (raw ?? '').trim().toUpperCase()
  if (!IDENTIFIER.test(identifier)) throw new ForgeError('not-found', `not a Linear issue: ${raw ?? '(none)'}`)
  return identifier
}

function numberOf(raw: string | undefined): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new ForgeError('not-found', `not an issue number: ${raw}`)
  return value
}

export function createForgeRoutes(): Hono {
  const api = new Hono()

  api.onError((error, c) => {
    if (error instanceof ForgeError) {
      return c.json(
        { error: error.message, kind: error.kind, hint: error.hint ?? null },
        { status: FORGE_STATUS[error.kind] },
      )
    }
    return c.json({ error: String(error), kind: 'failed' as const, hint: null }, { status: 502 })
  })

  /**
   * Whether this host can operate either provider. Never fails: the answer *is*
   * the diagnosis, and the panel needs it before it offers anything.
   */
  api.get('/status', async (c) => {
    const [github, linear] = await Promise.all([ghStatus(), linearStatus()])
    return c.json({ github, linear })
  })

  // --- Linear -------------------------------------------------------------
  // The same four operations as GitHub, against the client Taskflow already
  // has. A Linear issue is addressed by its identifier (`ENG-42`), which is why
  // these are not the same routes with a different query parameter: the
  // coordinates genuinely differ, and pretending otherwise would mean a
  // repository-shaped argument that Linear has no use for.

  api.get('/linear/issues', async (c) => {
    const state = c.req.query('state')
    const limit = Number(c.req.query('limit'))
    return c.json(
      await listTeamIssues(teamKeyOf(c.req.query('team')), {
        state: state === 'closed' || state === 'all' ? state : 'open',
        limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
      }),
    )
  })

  api.get('/linear/issues/:identifier', async (c) =>
    c.json(await viewLinearIssue(identifierOf(c.req.param('identifier')))),
  )

  api.post('/linear/issues', async (c) => {
    const draft = (await c.req.json()) as { title?: string; body?: string }
    if (!draft?.title?.trim()) throw new ForgeError('failed', 'an issue needs a title')
    return c.json(await createLinearIssue(teamKeyOf(c.req.query('team')), { title: draft.title, body: draft.body }), {
      status: 201,
    })
  })

  api.patch('/linear/issues/:identifier', async (c) =>
    c.json(
      await editLinearIssue(
        identifierOf(c.req.param('identifier')),
        (await c.req.json()) as { title?: string; body?: string; state?: 'open' | 'closed' },
      ),
    ),
  )

  api.post('/linear/issues/:identifier/comments', async (c) => {
    const { body } = (await c.req.json()) as { body?: string }
    if (!body?.trim()) throw new ForgeError('failed', 'a comment needs a body')
    return c.json(await commentOnLinearIssue(identifierOf(c.req.param('identifier')), body))
  })

  // --- GitHub -------------------------------------------------------------

  api.get('/issues', async (c) => {
    const query = c.req.query()
    const state = query.state
    return c.json(
      await listIssues(repositoryOf(query.repo), {
        state: state === 'closed' || state === 'all' ? state : 'open',
        assignee: query.assignee,
        label: query.label,
        milestone: query.milestone,
        search: query.q,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    )
  })

  api.get('/issues/:number', async (c) =>
    c.json(await viewIssue(repositoryOf(c.req.query('repo')), numberOf(c.req.param('number')))),
  )

  api.post('/issues', async (c) => {
    const draft = (await c.req.json()) as IssueDraft
    if (!draft?.title?.trim()) throw new ForgeError('failed', 'an issue needs a title')
    return c.json(await createIssue(repositoryOf(c.req.query('repo')), draft), { status: 201 })
  })

  api.patch('/issues/:number', async (c) => {
    const repo = repositoryOf(c.req.query('repo'))
    const number = numberOf(c.req.param('number'))
    const patch = (await c.req.json()) as IssuePatch & {
      state?: 'open' | 'closed'
      stateReason?: 'completed' | 'not planned'
    }
    // State is a separate `gh` verb (`close`/`reopen`), so it is applied after
    // the edit: reopening and retitling in one request should leave the title
    // changed even if the reopen is refused, not the other way round.
    const { state, stateReason, ...fields } = patch
    await editIssue(repo, number, fields)
    if (state) await setIssueState(repo, number, state, stateReason)
    return c.json(await viewIssue(repo, number))
  })

  api.post('/issues/:number/comments', async (c) => {
    const repo = repositoryOf(c.req.query('repo'))
    const number = numberOf(c.req.param('number'))
    const { body } = (await c.req.json()) as { body?: string }
    if (!body?.trim()) throw new ForgeError('failed', 'a comment needs a body')
    await commentOnIssue(repo, number, body)
    return c.json(await viewIssue(repo, number))
  })

  api.get('/vocabulary', async (c) => c.json(await issueVocabulary(repositoryOf(c.req.query('repo')))))

  /** The dashboard's one call: what is assigned to whoever is signed in, everywhere. */
  api.get('/assigned', async (c) => {
    const limit = Number(c.req.query('limit'))
    return c.json(await assignedIssues(Number.isInteger(limit) && limit > 0 ? limit : undefined))
  })

  return api
}
