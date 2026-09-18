// Work lives in GitHub or in Linear, and Portta points at it.
//
// Portta does not have a task of its own any more
// (docs/development/adr/0050-work-lives-in-an-external-provider.md). What it
// keeps is a *reference*: which provider, and which issue there. Everything the
// panel, the CLI and the host daemon store about work — the environment an
// issue is being worked in, the session somebody opened for it, the activity
// that mentions it — is that one string.
//
// The string is deliberately human-readable and stable, because it ends up in
// rows nobody migrates: `github:codions-labs/portta#113`, `linear:ENG-42`. It
// carries no database id, so re-linking a repository or re-installing Linear
// does not orphan a row.
//
// Pure string work: no network, no token, no client. The two providers are
// named here and implemented once each — this is not a provider framework.

/** The two places work can live. There is no third, and no local mode. */
export const TASK_PROVIDERS = ['github', 'linear'] as const
export type TaskProvider = (typeof TASK_PROVIDERS)[number]

export function isTaskProvider(value: string): value is TaskProvider {
  return (TASK_PROVIDERS as readonly string[]).includes(value)
}

/** GitHub's own issue vocabulary, and the only one Portta projects onto Linear. */
export const ISSUE_STATES = ['open', 'closed'] as const
export type IssueState = (typeof ISSUE_STATES)[number]

export interface IssueRef {
  provider: TaskProvider
  /** `owner/repo#number` for GitHub, the team-prefixed identifier for Linear. */
  key: string
}

/** `owner/repo#123`, with the pieces a `gh` call needs. */
export interface GitHubIssueRef extends IssueRef {
  provider: 'github'
  /** `owner/repo`, exactly as `gh --repo` wants it. */
  slug: string
  number: number
}

const GITHUB_KEY = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/
// Linear identifiers are a team key and a number: `ENG-42`. Uppercased, because
// the API returns them that way and a ref that differs only in case is a second
// row for the same issue.
const LINEAR_KEY = /^[A-Z][A-Z0-9]{0,9}-\d+$/

export function formatIssueRef(provider: TaskProvider, key: string): string {
  return `${provider}:${key}`
}

export function githubIssueRef(slug: string, number: number): string {
  return formatIssueRef('github', `${slug}#${number}`)
}

/**
 * Reads a ref back, or refuses it.
 *
 * Refusing rather than guessing matters: these strings arrive from a URL, a CLI
 * argument and an agent, and a ref that parsed "close enough" would address a
 * different issue than the one somebody meant.
 */
export function parseIssueRef(raw: string): IssueRef | null {
  const value = raw.trim()
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const provider = value.slice(0, separator).toLowerCase()
  const key = value.slice(separator + 1).trim()
  if (!isTaskProvider(provider) || key === '') return null
  if (provider === 'github') return GITHUB_KEY.test(key) ? { provider, key } : null
  return LINEAR_KEY.test(key.toUpperCase()) ? { provider, key: key.toUpperCase() } : null
}

/** The same, narrowed to GitHub and split into what an API call needs. */
export function parseGitHubIssueRef(raw: string): GitHubIssueRef | null {
  const ref = parseIssueRef(raw)
  if (ref?.provider !== 'github') return null
  const match = GITHUB_KEY.exec(ref.key)
  if (!match) return null
  return { provider: 'github', key: ref.key, slug: match[1] as string, number: Number(match[2]) }
}

/** What a person sees: `portta#113`, `ENG-42`. Never the provider prefix. */
export function issueRefLabel(raw: string): string {
  const ref = parseIssueRef(raw)
  if (!ref) return raw
  if (ref.provider !== 'github') return ref.key
  const match = GITHUB_KEY.exec(ref.key)
  const slug = match?.[1] ?? ''
  return `${slug.slice(slug.indexOf('/') + 1)}#${match?.[2] ?? ''}`
}

/**
 * Who acted. `system` is Portta itself: a timer, a job, a migration.
 *
 * It lived with the task vocabulary and outlived it, because sessions, activity
 * and audit all still record it.
 */
export const ACTOR_KINDS = ['human', 'agent', 'system'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

/**
 * Which issue an environment is being worked on, from what the environment
 * itself declares. Pure: the caller supplies labels, branch and namespace.
 *
 * Order matters and first match wins: an explicit label beats a branch name,
 * and a branch name beats a namespace suffix. The label carries a whole ref
 * (`github:owner/repo#113`) because an environment is not inside a Project and
 * has nothing else to resolve a bare number against; a branch and a namespace
 * carry only a number, so they are read relative to the Project's own
 * repository by the caller.
 */
export const ISSUE_LABEL = 'portta.issue'

export function issueRefFromLabel(labels: Record<string, string>): string | null {
  const ref = parseIssueRef(labels[ISSUE_LABEL]?.trim() ?? '')
  return ref ? formatIssueRef(ref.provider, ref.key) : null
}

/** `feature/issue-113`, `113-fix-the-thing` — the number, with no provider. */
export function issueNumberFromBranch(branch: string | null): number | null {
  if (!branch) return null
  const match = /(?:^|\/)(?:issue|task)[-_]?(\d{1,9})(?:[-_/]|$)/i.exec(branch) ?? /(?:^|\/)(\d{1,9})[-_]/.exec(branch)
  return match ? Number(match[1]) : null
}

/** `shop-issue113` — the trailing number a worktree namespace carries. */
export function issueNumberFromNamespace(namespace: string | null): number | null {
  if (!namespace) return null
  const match = /[-_](?:issue|task)(\d{1,9})$/i.exec(namespace)
  return match ? Number(match[1]) : null
}

/**
 * Where the issue actually is, so every link in the panel is built once.
 *
 * Linear has no URL derivable from the identifier alone — the workspace slug is
 * part of it — so a Linear ref links nowhere from here and the provider's own
 * response carries the URL.
 */
export function issueRefUrl(raw: string): string | null {
  const ref = parseGitHubIssueRef(raw)
  return ref ? `https://github.com/${ref.slug}/issues/${ref.number}` : null
}
