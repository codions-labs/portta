// Linear, through the client Taskflow already has.
//
// Scope 5 of issue #113 says to reuse what Taskflow implemented rather than
// write a second Linear client, and that is literally what this does:
// `postLinearGraphql` is Taskflow's — same key, same endpoint, same error
// shape. What lives here is only the handful of queries the panel's work
// surface needs and Taskflow never did: listing a team's issues, reading one,
// writing one, and moving it between states.
//
// Linear has no notion of "open" and "closed". It has workflow states with a
// *type*: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`.
// Portta projects the last two onto `closed` and everything else onto `open`,
// and keeps the state's own name in `stateReason` so a person still sees "In
// Review" rather than a word Linear never used.

import { postLinearGraphql } from '../modules/taskflow/services/linear-service.ts'
import { ForgeError } from './gh.ts'

const CLOSED_TYPES = new Set(['completed', 'canceled'])

export interface LinearForgeIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  url: string
  createdAt: string
  updatedAt: string
  state: { name: string; type: string } | null
  assignee: { name: string; displayName?: string | null; avatarUrl?: string | null } | null
  creator: { name: string; displayName?: string | null; avatarUrl?: string | null } | null
  labels?: { nodes: Array<{ name: string; color: string | null }> }
  project?: { name: string } | null
  comments?: {
    nodes: Array<{
      id: string
      body: string
      createdAt: string
      updatedAt: string | null
      url: string | null
      user: { name: string; avatarUrl?: string | null } | null
    }>
  }
}

export function isClosed(issue: LinearForgeIssue): boolean {
  return CLOSED_TYPES.has(issue.state?.type ?? '')
}

const ISSUE_FIELDS = `
  id identifier title url createdAt updatedAt
  state { name type }
  assignee { name displayName avatarUrl }
  creator { name displayName avatarUrl }
  labels { nodes { name color } }
  project { name }
`

const TEAM_ISSUES_QUERY = `
  query TeamIssues($key: String!, $first: Int!, $closed: Boolean!) {
    issues(
      filter: { team: { key: { eq: $key } }, state: { type: { nin: ["completed", "canceled"] } } }
      orderBy: updatedAt
      first: $first
    ) @skip(if: $closed) { nodes { ${ISSUE_FIELDS} } }
    all: issues(filter: { team: { key: { eq: $key } } }, orderBy: updatedAt, first: $first)
      @include(if: $closed) { nodes { ${ISSUE_FIELDS} } }
  }
`

const ISSUE_QUERY = `
  query Issue($id: String!) {
    issue(id: $id) {
      ${ISSUE_FIELDS}
      description
      comments(first: 100) { nodes { id body createdAt updatedAt url user { name avatarUrl } } }
    }
  }
`

interface Gql<T> {
  data?: T
  errors?: Array<{ message: string }>
}

async function query<T>(document: string, variables: Record<string, unknown>): Promise<T> {
  const response = await postLinearGraphql<T>(document, variables)
  if (!response.ok) {
    // A missing key is configuration, not an outage, and the panel shows a
    // different screen for each.
    const kind = response.error.includes('LINEAR_API_KEY') ? 'unauthenticated' : 'failed'
    throw new ForgeError(
      kind,
      response.error,
      kind === 'unauthenticated' ? 'set LINEAR_API_KEY on this host' : undefined,
    )
  }
  const body = response.data as Gql<T>
  if (body.errors?.length) throw new ForgeError('failed', body.errors.map((e) => e.message).join('; '))
  if (!body.data) throw new ForgeError('failed', 'Linear answered with no data')
  return body.data
}

/** A team key, and nothing that could be read as another argument or injected into a filter. */
const TEAM_KEY = /^[A-Z][A-Z0-9]{0,9}$/

export function teamKeyOf(raw: string | undefined): string {
  const key = (raw ?? '').trim().toUpperCase()
  if (!TEAM_KEY.test(key))
    throw new ForgeError('failed', `not a Linear team key: ${raw ?? '(none)'}`, 'expected something like ENG')
  return key
}

export async function listTeamIssues(
  teamKey: string,
  options: { state?: 'open' | 'closed' | 'all'; limit?: number } = {},
): Promise<LinearForgeIssue[]> {
  const closed = options.state === 'closed' || options.state === 'all'
  const data = await query<{ issues?: { nodes: LinearForgeIssue[] }; all?: { nodes: LinearForgeIssue[] } }>(
    TEAM_ISSUES_QUERY,
    { key: teamKey, first: options.limit ?? 100, closed },
  )
  const nodes = (closed ? data.all?.nodes : data.issues?.nodes) ?? []
  // `all` really is all, so `closed` alone is filtered here rather than with a
  // fourth query variant.
  return options.state === 'closed' ? nodes.filter(isClosed) : nodes
}

export function viewIssue(identifier: string): Promise<LinearForgeIssue> {
  return query<{ issue: LinearForgeIssue | null }>(ISSUE_QUERY, { id: identifier }).then((data) => {
    if (!data.issue) throw new ForgeError('not-found', `no Linear issue ${identifier}`)
    return data.issue
  })
}

const CREATE_MUTATION = `
  mutation Create($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { identifier } }
  }
`

export async function createIssue(teamKey: string, draft: { title: string; body?: string }): Promise<LinearForgeIssue> {
  const team = await query<{ teams: { nodes: Array<{ id: string }> } }>(
    'query Team($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id } } }',
    { key: teamKey },
  )
  const teamId = team.teams.nodes[0]?.id
  if (!teamId) throw new ForgeError('not-found', `no Linear team ${teamKey}`)
  const created = await query<{ issueCreate: { success: boolean; issue: { identifier: string } | null } }>(
    CREATE_MUTATION,
    { input: { teamId, title: draft.title, description: draft.body ?? '' } },
  )
  const identifier = created.issueCreate.issue?.identifier
  if (!created.issueCreate.success || !identifier) throw new ForgeError('failed', 'Linear refused to create the issue')
  return viewIssue(identifier)
}

const UPDATE_MUTATION = `
  mutation Update($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success }
  }
`

/**
 * Editing, including the state.
 *
 * `open`/`closed` is Portta's vocabulary, not Linear's, so closing means
 * finding the team's first `completed` state and moving the issue there. There
 * is no single "closed" state to name: a team may have `Done`, `Released` and
 * `Duplicate`, all of type `completed`.
 */
export async function editIssue(
  identifier: string,
  patch: { title?: string; body?: string; state?: 'open' | 'closed' },
): Promise<LinearForgeIssue> {
  const issue = await viewIssue(identifier)
  const input: Record<string, unknown> = {}
  if (patch.title !== undefined) input.title = patch.title
  if (patch.body !== undefined) input.description = patch.body
  if (patch.state && (patch.state === 'closed') !== isClosed(issue)) {
    input.stateId = await stateIdFor(identifier, patch.state)
  }
  if (Object.keys(input).length > 0) {
    const result = await query<{ issueUpdate: { success: boolean } }>(UPDATE_MUTATION, { id: issue.id, input })
    if (!result.issueUpdate.success) throw new ForgeError('failed', 'Linear refused the change')
  }
  return viewIssue(identifier)
}

async function stateIdFor(identifier: string, state: 'open' | 'closed'): Promise<string> {
  const wanted = state === 'closed' ? ['completed'] : ['unstarted', 'backlog', 'started']
  const data = await query<{
    issue: { team: { states: { nodes: Array<{ id: string; type: string; position: number }> } } } | null
  }>('query States($id: String!) { issue(id: $id) { team { states { nodes { id type position } } } } }', {
    id: identifier,
  })
  const states = data.issue?.team.states.nodes ?? []
  const match = wanted
    .flatMap((type) => states.filter((s) => s.type === type))
    .sort((a, b) => a.position - b.position)[0]
  if (!match)
    throw new ForgeError('failed', `this Linear team has no ${state === 'closed' ? 'completed' : 'open'} state`)
  return match.id
}

const COMMENT_MUTATION = `
  mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }
`

export async function commentOnIssue(identifier: string, body: string): Promise<LinearForgeIssue> {
  const issue = await viewIssue(identifier)
  const result = await query<{ commentCreate: { success: boolean } }>(COMMENT_MUTATION, {
    input: { issueId: issue.id, body },
  })
  if (!result.commentCreate.success) throw new ForgeError('failed', 'Linear refused the comment')
  return viewIssue(identifier)
}

/** Whether this host can operate Linear at all. Shaped like `ghStatus` on purpose. */
export async function linearStatus(): Promise<{
  available: boolean
  authenticated: boolean
  account: string | null
  detail: string | null
}> {
  if (!process.env.LINEAR_API_KEY?.trim()) {
    return { available: false, authenticated: false, account: null, detail: 'LINEAR_API_KEY is not set on this host' }
  }
  try {
    const data = await query<{ viewer: { name: string } }>('query { viewer { name } }', {})
    return { available: true, authenticated: true, account: data.viewer.name, detail: null }
  } catch (error) {
    return { available: true, authenticated: false, account: null, detail: (error as Error).message }
  }
}
