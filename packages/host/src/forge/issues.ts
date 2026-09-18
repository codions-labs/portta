// GitHub Issues, as `gh` answers them.
//
// One function per operation the panel offers, each a thin shaping of a `gh`
// call. The shapes here are `gh`'s own — camelCase, ISO dates, nested `author`
// and `labels` — and stay that way: the panel projects them into the contract
// (`IssueSummary`, `Issue`) in one place, so this file has no opinion about how
// an issue is displayed and the projection has no opinion about how `gh` is
// spelled.
//
// Everything takes a `repo` of the form `owner/name`. The daemon never guesses
// it from a working directory: the panel knows which Project a request is for
// and which repository that Project is linked to, and a `gh` call that fell
// back to "whatever repo this directory is" would write to the wrong one.

import { ISSUE_PAGE_LIMIT, runGh, runGhJson } from './gh.ts'

/** What `gh issue list --json` gives for a row. Ordered as `gh` wants it. */
const LIST_FIELDS = [
  'number',
  'title',
  'state',
  'stateReason',
  'labels',
  'assignees',
  'milestone',
  'author',
  'comments',
  'createdAt',
  'updatedAt',
  'url',
].join(',')

/** The same, plus the body. Fetched only for one issue, because bodies are large. */
const VIEW_FIELDS = `${LIST_FIELDS},body`

export interface GhUser {
  login: string
  name?: string | null
  /** `gh` omits this on some shapes; the projection turns absent into null. */
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
}

export interface IssueQuery {
  state?: 'open' | 'closed' | 'all'
  assignee?: string
  label?: string
  milestone?: string
  /** Free text, passed to GitHub's own search. */
  search?: string
  limit?: number
}

export function listIssues(repo: string, query: IssueQuery = {}): Promise<GhIssue[]> {
  const args = [
    'issue',
    'list',
    '--repo',
    repo,
    '--json',
    LIST_FIELDS,
    '--limit',
    String(query.limit ?? ISSUE_PAGE_LIMIT),
  ]
  // `--state all` is the only way to see closed ones; `gh` defaults to open.
  args.push('--state', query.state ?? 'open')
  if (query.assignee) args.push('--assignee', query.assignee)
  if (query.label) args.push('--label', query.label)
  if (query.milestone) args.push('--milestone', query.milestone)
  if (query.search) args.push('--search', query.search)
  return runGhJson<GhIssue[]>(args)
}

/**
 * One issue with its body and its comments.
 *
 * `--comments` is not a `--json` field — `gh issue view --json comments` gives
 * only a count on the list shape — so the comments come from the API in a
 * second call. Two calls, done in parallel, rather than one call that returns
 * a page of prose the panel has to scrape.
 */
export async function viewIssue(repo: string, number: number): Promise<GhIssue & { comments: GhComment[] }> {
  const [issue, comments] = await Promise.all([
    runGhJson<GhIssue>(['issue', 'view', String(number), '--repo', repo, '--json', VIEW_FIELDS]),
    runGhJson<GhComment[]>([
      'api',
      `repos/${repo}/issues/${number}/comments`,
      '--paginate',
      '--jq',
      '[.[] | {id: (.id|tostring), body: .body, createdAt: .created_at, updatedAt: .updated_at, url: .html_url, author: {login: .user.login, avatarUrl: .user.avatar_url}}]',
    ]).catch(() => [] as GhComment[]),
  ])
  return { ...issue, comments }
}

export interface IssueDraft {
  title: string
  body?: string
  labels?: string[]
  assignees?: string[]
  milestone?: string
}

/**
 * Creating one, and reading it back.
 *
 * `gh issue create` prints the URL and nothing else, so the number is parsed
 * from it and the issue is fetched — the caller gets the same shape a read
 * gives, rather than a URL it would have to re-fetch anyway to render.
 */
export async function createIssue(repo: string, draft: IssueDraft): Promise<GhIssue & { comments: GhComment[] }> {
  const args = ['issue', 'create', '--repo', repo, '--title', draft.title, '--body', draft.body ?? '']
  for (const label of draft.labels ?? []) args.push('--label', label)
  for (const assignee of draft.assignees ?? []) args.push('--assignee', assignee)
  if (draft.milestone) args.push('--milestone', draft.milestone)
  const url = (await runGh(args)).trim().split('\n').pop() ?? ''
  const number = Number(/\/(\d+)\s*$/.exec(url)?.[1])
  if (!Number.isInteger(number)) {
    throw new Error(`gh issue create did not answer with an issue URL: ${url.slice(0, 200)}`)
  }
  return viewIssue(repo, number)
}

export interface IssuePatch {
  title?: string
  body?: string
  /** Replaces the set. The caller computes the difference; `gh` adds and removes. */
  addLabels?: string[]
  removeLabels?: string[]
  addAssignees?: string[]
  removeAssignees?: string[]
  /** An empty string clears it, which is how `gh` spells "no milestone". */
  milestone?: string
}

export async function editIssue(repo: string, number: number, patch: IssuePatch): Promise<void> {
  const fields: string[] = []
  if (patch.title !== undefined) fields.push('--title', patch.title)
  if (patch.body !== undefined) fields.push('--body', patch.body)
  for (const label of patch.addLabels ?? []) fields.push('--add-label', label)
  for (const label of patch.removeLabels ?? []) fields.push('--remove-label', label)
  for (const login of patch.addAssignees ?? []) fields.push('--add-assignee', login)
  for (const login of patch.removeAssignees ?? []) fields.push('--remove-assignee', login)
  if (patch.milestone !== undefined) fields.push('--milestone', patch.milestone)
  // Nothing to change is not an error, but `gh issue edit` with no field flag
  // is: it answers "field to edit flag required when not running
  // interactively". Counting the flags rather than the whole argv is what makes
  // this correct — a patch that only changes the state arrives here empty,
  // because the state is a different `gh` verb.
  if (fields.length === 0) return
  await runGh(['issue', 'edit', String(number), '--repo', repo, ...fields])
}

/** `gh` spells this as two verbs rather than a field, so it is its own call. */
export async function setIssueState(
  repo: string,
  number: number,
  state: 'open' | 'closed',
  reason?: 'completed' | 'not planned',
): Promise<void> {
  const verb = state === 'closed' ? 'close' : 'reopen'
  // `--reason` exists on `close` and not on `reopen`.
  const why = state === 'closed' && reason ? ['--reason', reason] : []
  await runGh(['issue', verb, String(number), '--repo', repo, ...why])
}

export async function commentOnIssue(repo: string, number: number, body: string): Promise<void> {
  // `--body-file -` rather than `--body`: a comment is arbitrary Markdown and
  // can be longer than a command line allows, and passing it as an argument
  // also puts it in the host's process listing.
  await runGh(['issue', 'comment', String(number), '--repo', repo, '--body-file', '-'], { stdin: body })
}

/**
 * What this repository can be written to: its labels, the people who may be
 * assigned, and its milestones.
 *
 * Fetched together because a form needs all three at once, and separately from
 * an issue because they belong to the repository rather than to any issue.
 */
export async function issueVocabulary(repo: string): Promise<{
  labels: GhLabel[]
  assignees: GhUser[]
  milestones: GhMilestone[]
}> {
  const [labels, assignees, milestones] = await Promise.all([
    runGhJson<GhLabel[]>(['label', 'list', '--repo', repo, '--json', 'name,color,description', '--limit', '200']).catch(
      () => [],
    ),
    runGhJson<GhUser[]>([
      'api',
      `repos/${repo}/assignees`,
      '--paginate',
      '--jq',
      '[.[] | {login: .login, avatarUrl: .avatar_url}]',
    ]).catch(() => []),
    runGhJson<GhMilestone[]>([
      'api',
      `repos/${repo}/milestones?state=all`,
      '--paginate',
      '--jq',
      '[.[] | {number: .number, title: .title, state: .state, dueOn: .due_on}]',
    ]).catch(() => []),
  ])
  return { labels, assignees, milestones }
}

/**
 * The open issues assigned to whoever is signed in, across every repository.
 *
 * One call for the whole dashboard. `gh search issues` answers across
 * repositories, which is why the panel does not ask per Project — that would be
 * one `gh` process per Project on every dashboard load.
 */
export function assignedIssues(limit = 50): Promise<Array<GhIssue & { repository?: { nameWithOwner?: string } }>> {
  return runGhJson<Array<GhIssue & { repository?: { nameWithOwner?: string } }>>([
    'search',
    'issues',
    '--assignee',
    '@me',
    '--state',
    'open',
    '--limit',
    String(limit),
    '--json',
    'number,title,state,labels,assignees,author,createdAt,updatedAt,url,repository',
  ])
}
