// Turning what a provider answered into what the contract promises.
//
// The projection is pure, so this needs no daemon, no token and no network.
// What is asserted is the translation itself — the places where the two
// providers disagree with each other or with the contract — rather than every
// field, which the schemas below already check in one line.

import { Issue, IssueSummary } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import {
  type GhIssue,
  githubIssue,
  githubSummary,
  type LinearIssue,
  linearIssue,
  linearSummary,
} from '../src/services/issues/view.ts'

const panelUrl = (ref: string) => `/projects/produto/issues/${encodeURIComponent(ref)}`

function gh(overrides: Partial<GhIssue> = {}): GhIssue {
  return {
    number: 113,
    title: 'Proxy TCP loses the connection',
    state: 'OPEN',
    author: { login: 'ada', name: 'Ada', avatarUrl: null },
    assignees: [{ login: 'claude' }],
    labels: [{ name: 'bug', color: 'ff0000' }],
    milestone: { number: 4, title: 'v1', state: 'open', dueOn: '2026-02-01T00:00:00Z' },
    comments: 3,
    body: 'it drops after a minute',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    url: 'https://github.com/acme/api/issues/113',
    ...overrides,
  }
}

function linear(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'uuid',
    identifier: 'ENG-42',
    title: 'Ship the importer',
    description: 'the CSV one',
    url: 'https://linear.app/acme/issue/ENG-42',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: { name: 'In Review', type: 'started' },
    assignee: { name: 'Ada Lovelace', displayName: 'ada', avatarUrl: null },
    creator: { name: 'Grace Hopper', displayName: 'grace', avatarUrl: null },
    ...overrides,
  }
}

describe('a GitHub issue as the contract wants it', () => {
  it('addresses the issue by ref and answers the contract', () => {
    const summary = githubSummary(gh(), 'acme/api', panelUrl)
    expect(IssueSummary.parse(summary)).toMatchObject({
      ref: 'github:acme/api#113',
      provider: 'github',
      key: '113',
      state: 'open',
      commentCount: 3,
      createdAt: 1_767_225_600,
      panelUrl: '/projects/produto/issues/github%3Aacme%2Fapi%23113',
    })
  })

  // `gh` answers OPEN/CLOSED, uppercase, on both list and view; a projection
  // that only knew one of them would show every searched issue as open.
  it('reads the state whichever way gh spelled it', () => {
    expect(githubSummary(gh({ state: 'CLOSED' }), 'acme/api', panelUrl).state).toBe('closed')
    expect(githubSummary(gh({ state: 'closed' }), 'acme/api', panelUrl).state).toBe('closed')
    expect(githubSummary(gh({ state: 'open' }), 'acme/api', panelUrl).state).toBe('open')
  })

  // The issue belongs to the repository that answered, not to the one asked
  // about: a cross-repository search returns rows from elsewhere.
  it('takes the repository from the row when the row names one', () => {
    expect(githubSummary(gh({ repository: { nameWithOwner: 'acme/other' } }), 'acme/api', panelUrl).ref).toBe(
      'github:acme/other#113',
    )
  })

  it('counts comments the same whether gh sent a number or the comments themselves', () => {
    const comments = [
      {
        id: 1,
        author: { login: 'grace' },
        body: 'reproduced',
        createdAt: '2026-01-03T00:00:00Z',
        updatedAt: null,
        url: null,
      },
    ]
    const issue = githubIssue({ ...gh(), comments }, 'acme/api', panelUrl, {
      environments: [],
      worktrees: [],
      activeSessionCount: 0,
    })
    expect(Issue.parse(issue).commentCount).toBe(1)
    expect(issue.comments[0]).toMatchObject({ id: '1', body: 'reproduced', updatedAt: null })
  })
})

describe('a Linear issue as the contract wants it', () => {
  it('addresses the issue by ref and answers the contract', () => {
    const summary = linearSummary(linear(), panelUrl)
    expect(IssueSummary.parse(summary)).toMatchObject({
      ref: 'linear:ENG-42',
      provider: 'linear',
      key: 'ENG-42',
      assignees: [{ login: 'ada', name: 'Ada Lovelace' }],
    })
  })

  // Linear has workflow states rather than two booleans. Only `completed` and
  // `canceled` mean the work is not coming back; the state's own name survives
  // so a person still reads "In Review" rather than a word Linear never used.
  it('closes only the two state types that mean the work is over, and keeps the state name', () => {
    for (const type of ['completed', 'canceled']) {
      const summary = linearSummary(linear({ state: { name: 'Done', type } }), panelUrl)
      expect(summary.state, type).toBe('closed')
      expect(summary.stateReason, type).toBe('Done')
    }
    for (const type of ['triage', 'backlog', 'unstarted', 'started']) {
      expect(linearSummary(linear({ state: { name: 'In Review', type } }), panelUrl).state, type).toBe('open')
    }
    expect(linearSummary(linear({ state: null }), panelUrl)).toMatchObject({ state: 'open', stateReason: null })
  })

  // Linear's nearest thing to a milestone is the project an issue belongs to.
  // It has no number and no state, and saying so beats inventing one.
  it('presents the Linear project as a milestone with nothing invented', () => {
    expect(linearSummary(linear({ project: { name: 'Q1' } }), panelUrl).milestone).toEqual({
      title: 'Q1',
      number: null,
      state: null,
      dueOn: null,
    })
    expect(linearSummary(linear(), panelUrl).milestone).toBeNull()
  })

  it('carries the description as the body and the comments in order', () => {
    const issue = linearIssue(
      linear({
        comments: {
          nodes: [
            {
              id: 'c1',
              body: 'first',
              createdAt: '2026-01-03T00:00:00Z',
              updatedAt: null,
              url: null,
              user: { name: 'Ada' },
            },
          ],
        },
      }),
      panelUrl,
      { environments: [], worktrees: [], activeSessionCount: 0 },
    )
    expect(Issue.parse(issue)).toMatchObject({ body: 'the CSV one', commentCount: 1 })
    expect(issue.comments[0]).toMatchObject({ id: 'c1', author: { login: 'Ada' } })
  })
})

// A NaN fails the contract's `z.number()`, which would turn one malformed row
// into a failed page. A visibly wrong date on one row is the cheaper answer.
describe('a date the provider sent that nobody can read', () => {
  it('becomes zero rather than NaN, on both providers', () => {
    const fromGitHub = githubSummary(
      gh({ createdAt: 'yesterday', updatedAt: '', milestone: { title: 'v1', dueOn: 'soon' } }),
      'acme/api',
      panelUrl,
    )
    expect(IssueSummary.safeParse(fromGitHub).success).toBe(true)
    expect(fromGitHub).toMatchObject({ createdAt: 0, updatedAt: 0 })
    expect(fromGitHub.milestone?.dueOn).toBe(0)

    const fromLinear = linearSummary(linear({ createdAt: 'whenever', updatedAt: 'whenever' }), panelUrl)
    expect(IssueSummary.safeParse(fromLinear).success).toBe(true)
    expect(fromLinear).toMatchObject({ createdAt: 0, updatedAt: 0 })
  })
})
