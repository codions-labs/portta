// What `git status --porcelain=v2 --branch` and `git log -1` say, as a project's code state.
//
// Pure: the collector runs git on the host and hands the text here, so the reading
// is tested without a repository and the CLI is the only part that spawns anything.

export interface GitFile {
  path: string
  status: 'M' | 'A' | 'D' | 'U'
}

export interface GitHead {
  sha: string
  subject: string
  author: string
  at: number
}

export const GIT_FILE_LIMIT = 20

/** What a repository says is its own to say, so none of it is allowed to be large. */
const LIMITS = { path: 512, name: 256, subject: 200, author: 200 } as const

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

export interface ParsedStatus {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number | null
  behind: number | null
  oid: string | null
  changed: number
  untracked: number
  files: GitFile[]
}

function statusOf(xy: string): GitFile['status'] {
  if (xy.includes('D')) return 'D'
  if (xy.includes('A')) return 'A'
  return 'M'
}

/** `--porcelain=v2 --branch --no-renames`, one entry per line. */
export function parseGitStatus(text: string): ParsedStatus {
  const parsed: ParsedStatus = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
    oid: null,
    changed: 0,
    untracked: 0,
    files: [],
  }
  for (const line of text.split('\n')) {
    if (line === '') continue
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length)
      parsed.oid = oid === '(initial)' ? null : oid
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      parsed.detached = head === '(detached)'
      parsed.branch = parsed.detached ? null : clip(head, LIMITS.name)
    } else if (line.startsWith('# branch.upstream ')) {
      parsed.upstream = clip(line.slice('# branch.upstream '.length), LIMITS.name)
    } else if (line.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
      if (match) {
        parsed.ahead = Number(match[1])
        parsed.behind = Number(match[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('u ')) {
      // `1 XY sub mH mI mW hH hI path`: the path is everything after the eighth space.
      const fields = line.split(' ')
      const path = fields.slice(line.startsWith('u ') ? 10 : 8).join(' ')
      parsed.changed += 1
      if (parsed.files.length < GIT_FILE_LIMIT && path !== '') {
        parsed.files.push({ path: clip(path, LIMITS.path), status: statusOf(fields[1] ?? '') })
      }
    } else if (line.startsWith('? ')) {
      parsed.untracked += 1
      if (parsed.files.length < GIT_FILE_LIMIT)
        parsed.files.push({ path: clip(line.slice(2), LIMITS.path), status: 'U' })
    }
  }
  return parsed
}

/** `git log -1 --format=%h%x1f%s%x1f%an%x1f%ct`. Null for a repository with no commit. */
export function parseGitHead(text: string): GitHead | null {
  const [sha, subject, author, at] = text.trim().split('\u001f')
  const seconds = Number(at)
  if (!sha || subject === undefined || author === undefined || !Number.isSafeInteger(seconds)) return null
  return {
    sha: clip(sha, 40),
    subject: clip(subject, LIMITS.subject),
    author: clip(author, LIMITS.author),
    at: seconds,
  }
}

/**
 * Whether a repository's own configuration can make git run something while it only reads.
 *
 * `git status` runs a clean filter and an fsmonitor, `log` can run a signature program, and
 * a remote can name a helper, all from keys a repository carries. Reading is refused for a
 * repository that sets any of them, or that names another work tree, or is bare.
 *
 * Takes `git config --file <the repository's config> --list -z`: records end in NUL, and a
 * record is the key, a newline and the value. The key is everything before that first newline,
 * whatever it contains (a tab in a subsection included), so nothing the file says can move
 * a key out of the check. It reads the one file git is about to be pointed at, never the
 * owner's own configuration.
 */
export function repositoryRunsCommands(configRecords: string): boolean {
  const dangerous = [
    /^filter\./,
    /^core\.(fsmonitor|sshcommand|pager|editor|askpass|gitproxy|hookspath|attributesfile|alternaterefscommand|worktree)$/,
    /^gpg\./,
    /^diff\..*\.(textconv|command)$/,
    /^credential\./,
    /^remote\..*\.(uploadpack|receivepack|promisor|vcs|proxy)$/,
    /^extensions\.(partialclone|worktreeconfig)$/,
    /^(include|includeif)\./,
    /^uploadpack\./,
    /^protocol\./,
    /^url\./,
    /^submodule\..*\.(update|fetchrecursesubmodules)$/,
  ]
  for (const record of configRecords.split('\0')) {
    if (record === '') continue
    const newline = record.indexOf('\n')
    const key = (newline === -1 ? record : record.slice(0, newline)).toLowerCase()
    const value = newline === -1 ? '' : record.slice(newline + 1)
    if (dangerous.some((pattern) => pattern.test(key))) return true
    // Every repository says `core.bare=false`; a bare one has no work tree to read.
    if (key === 'core.bare' && value.trim().toLowerCase() !== 'false') return true
  }
  return false
}
