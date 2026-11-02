// What `git status --porcelain=v2 --branch` and `git log -1` say, as a project's code state.
//
// Pure: the collector runs git on the host and hands the text here, so the reading
// is tested without a repository and the CLI is the only part that spawns anything.

import type { GitState } from 'portta-contracts'

type GitFile = GitState['files'][number]

export const GIT_FILE_LIMIT = 20

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
      parsed.branch = parsed.detached ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      parsed.upstream = line.slice('# branch.upstream '.length)
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
        parsed.files.push({ path, status: statusOf(fields[1] ?? '') })
      }
    } else if (line.startsWith('? ')) {
      parsed.untracked += 1
      if (parsed.files.length < GIT_FILE_LIMIT) parsed.files.push({ path: line.slice(2), status: 'U' })
    }
  }
  return parsed
}

/** `git log -1 --format=%h%x1f%s%x1f%an%x1f%ct`. Null for a repository with no commit. */
export function parseGitHead(text: string): GitState['head'] {
  const [sha, subject, author, at] = text.trim().split('\u001f')
  const seconds = Number(at)
  if (!sha || subject === undefined || author === undefined || !Number.isSafeInteger(seconds)) return null
  return { sha, subject, author, at: seconds }
}
