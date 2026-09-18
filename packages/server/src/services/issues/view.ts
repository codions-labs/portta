// Turning what a provider answered into what the contract promises.
//
// Two shapes in, one out. This is the only file that knows `gh` spells a body
// `body` and Linear spells it `description`, or that Linear has no notion of
// open and closed and Portta derives it from the state's *type*. Everything
// downstream — routes, the panel, the CLI — sees `IssueSummary` and `Issue` and
// never asks which provider produced them.
//
// Nothing here reads a database or makes a request. Given rows, it is pure, so
// the projection can be tested without a daemon, a token or a network.

import type { Issue, IssueComment, IssueLabel, IssueMilestone, IssueSummary, IssueUser } from 'portta-contracts'
import { formatIssueRef, githubIssueRef, type IssueState } from 'portta-core'

// --- what the daemon hands back -------------------------------------------

export interface GhUser {
  login: string
  name?: string | null
  avatarUrl?: string | null
}
export interface GhLabel {
  name: string
  color?: string | null
  description?: string | null
}
export interface GhMilestone {
  number?: number | null
  title: string
  state?: string | null
  dueOn?: string | null
}
export interface GhComment {
  id?: string | number
  author?: GhUser | null
  body: string
  createdAt: string
  updatedAt?: string | null
  url?: string | null
}

export interface GhIssue {
  number: number
  title: string
  state: string
  stateReason?: string | null
  labels?: GhLabel[]
  assignees?: GhUser[]
  milestone?: GhMilestone | null
  author?: GhUser | null
  comments?: GhComment[] | number
  body?: string | null
  createdAt: string
  updatedAt: string
  url: string
  repository?: { nameWithOwner?: string } | null
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string | null
  url: string
  createdAt: string
  updatedAt: string
  state: { name: string; type: string } | null
  assignee: { name: string; displayName?: string | null; avatarUrl?: string | null } | null
  creator: { name: string; displayName?: string | null; avatarUrl?: string | null } | null
  labels?: { nodes: Array<{ name: string; color: string | null }> }
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
  project?: { name: string } | null
}

// --- helpers ---------------------------------------------------------------

/**
 * ISO 8601 to Unix seconds, which is what every timestamp in the contract is.
 *
 * An unparseable date becomes 0 rather than NaN: `NaN` fails the contract's
 * `z.number()` and would turn one malformed row from a provider into a failed
 * page, where 0 is a visibly wrong date on one row.
 */
function seconds(iso: string | null | undefined): number {
  if (!iso) return 0
  const value = Date.parse(iso)
  return Number.isFinite(value) ? Math.floor(value / 1000) : 0
}

function optionalSeconds(iso: string | null | undefined): number | null {
  return iso ? seconds(iso) : null
}

function ghUser(user: GhUser | null | undefined): IssueUser | null {
  if (!user?.login) return null
  return { login: user.login, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null }
}

function ghLabels(labels: GhLabel[] | undefined): IssueLabel[] {
  return (labels ?? []).map((label) => ({
    name: label.name,
    color: label.color ?? null,
    description: label.description ?? null,
  }))
}

function ghMilestone(milestone: GhMilestone | null | undefined): IssueMilestone | null {
  if (!milestone?.title) return null
  return {
    title: milestone.title,
    number: milestone.number ?? null,
    state: milestone.state ?? null,
    dueOn: optionalSeconds(milestone.dueOn),
  }
}

/** `gh` gives a count on a listing and an array on a view; both mean the same thing. */
function commentCount(comments: GhComment[] | number | undefined): number {
  if (typeof comments === 'number') return comments
  return comments?.length ?? 0
}

// --- GitHub ----------------------------------------------------------------

export function githubSummary(issue: GhIssue, repo: string, panelUrl: (ref: string) => string): IssueSummary {
  const slug = issue.repository?.nameWithOwner ?? repo
  const ref = githubIssueRef(slug, issue.number)
  return {
    ref,
    provider: 'github',
    key: String(issue.number),
    title: issue.title,
    // `gh` answers OPEN/CLOSED, uppercase, on both `issue list` and `issue view`.
    state: issue.state.toLowerCase() === 'closed' ? 'closed' : 'open',
    stateReason: issue.stateReason ?? null,
    labels: ghLabels(issue.labels),
    assignees: (issue.assignees ?? []).map(ghUser).filter((user): user is IssueUser => user !== null),
    milestone: ghMilestone(issue.milestone),
    author: ghUser(issue.author),
    commentCount: commentCount(issue.comments),
    createdAt: seconds(issue.createdAt),
    updatedAt: seconds(issue.updatedAt),
    url: issue.url,
    panelUrl: panelUrl(ref),
  }
}

export function githubIssue(
  issue: GhIssue & { comments: GhComment[] },
  repo: string,
  panelUrl: (ref: string) => string,
  extra: Pick<Issue, 'environments' | 'worktrees' | 'activeSessionCount'>,
): Issue {
  return {
    ...githubSummary(issue, repo, panelUrl),
    commentCount: issue.comments.length,
    body: issue.body ?? null,
    comments: issue.comments.map(
      (comment, index): IssueComment => ({
        id: String(comment.id ?? index),
        author: ghUser(comment.author),
        body: comment.body,
        createdAt: seconds(comment.createdAt),
        updatedAt: optionalSeconds(comment.updatedAt),
        url: comment.url ?? null,
      }),
    ),
    ...extra,
  }
}

// --- Linear ----------------------------------------------------------------

/**
 * Linear has workflow states, not two booleans.
 *
 * `completed` and `canceled` are the two types that mean the work is not coming
 * back; everything else — `triage`, `backlog`, `unstarted`, `started` — is
 * open. The state's own name survives in `stateReason`, so a person still reads
 * "In Review" rather than a word Linear never used.
 */
export function linearState(issue: LinearIssue): IssueState {
  const type = issue.state?.type ?? ''
  return type === 'completed' || type === 'canceled' ? 'closed' : 'open'
}

function linearUser(user: LinearIssue['assignee']): IssueUser | null {
  if (!user) return null
  return { login: user.displayName ?? user.name, name: user.name, avatarUrl: user.avatarUrl ?? null }
}

export function linearSummary(issue: LinearIssue, panelUrl: (ref: string) => string): IssueSummary {
  const ref = formatIssueRef('linear', issue.identifier)
  const assignee = linearUser(issue.assignee)
  return {
    ref,
    provider: 'linear',
    key: issue.identifier,
    title: issue.title,
    state: linearState(issue),
    stateReason: issue.state?.name ?? null,
    labels: (issue.labels?.nodes ?? []).map((label) => ({ name: label.name, color: label.color, description: null })),
    assignees: assignee ? [assignee] : [],
    // Linear's nearest thing to a milestone is the project an issue belongs to.
    // It has no number and no state, and saying so is better than inventing one.
    milestone: issue.project ? { title: issue.project.name, number: null, state: null, dueOn: null } : null,
    author: linearUser(issue.creator),
    commentCount: issue.comments?.nodes.length ?? 0,
    createdAt: seconds(issue.createdAt),
    updatedAt: seconds(issue.updatedAt),
    url: issue.url,
    panelUrl: panelUrl(ref),
  }
}

export function linearIssue(
  issue: LinearIssue,
  panelUrl: (ref: string) => string,
  extra: Pick<Issue, 'environments' | 'worktrees' | 'activeSessionCount'>,
): Issue {
  return {
    ...linearSummary(issue, panelUrl),
    body: issue.description ?? null,
    comments: (issue.comments?.nodes ?? []).map(
      (comment): IssueComment => ({
        id: comment.id,
        author: comment.user
          ? { login: comment.user.name, name: comment.user.name, avatarUrl: comment.user.avatarUrl ?? null }
          : null,
        body: comment.body,
        createdAt: seconds(comment.createdAt),
        updatedAt: optionalSeconds(comment.updatedAt),
        url: comment.url,
      }),
    ),
    ...extra,
  }
}
