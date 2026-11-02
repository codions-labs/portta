// Where a project's code stands, read where the code is.
//
// The panel never opens a project's folder; the collector runs on the host and does.
// Read-only and local on purpose: nothing here fetches, pulls or asks a remote
// anything, so `ahead` and `behind` are as of the last fetch somebody did.
//
// The directory comes from a label any container can carry, so git is held on a
// short lead: no optional locks (it must not write the index), no prompts, no
// fsmonitor (a repository can name a command there) and no hooks path.

import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { GitState } from 'portta-contracts'
import { GIT_FILE_LIMIT, parseGitHead, parseGitStatus } from 'portta-core'
import { runProcess } from '../process.js'

const TIMEOUT_MS = 5_000
const CACHE_MS = 30_000
const MTIME_FILES = 50

const cache = new Map<string, { at: number; state: GitState | null }>()

async function git(directory: string, args: readonly string[]): Promise<string | null> {
  const result = await runProcess(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', directory, ...args],
    {
      reject: false,
      timeout: TIMEOUT_MS,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    },
  )
  return result.failed ? null : result.stdout
}

function newestMtime(directory: string, files: GitState['files']): number | null {
  let newest: number | null = null
  for (const file of files.slice(0, MTIME_FILES)) {
    if (file.status === 'D') continue
    try {
      const seconds = Math.floor(statSync(join(directory, file.path)).mtimeMs / 1000)
      if (newest === null || seconds > newest) newest = seconds
    } catch {
      // Gone since git looked: it has nothing to say about when.
    }
  }
  return newest
}

/** Null when this is not a work tree git can read, or git is not there. */
export async function readGit(directory: string, now = Date.now()): Promise<GitState | null> {
  if (!isAbsolute(directory) || directory.includes('\0')) return null
  const cached = cache.get(directory)
  if (cached && now - cached.at < CACHE_MS) return cached.state

  const state = await read(directory, Math.floor(now / 1000))
  cache.set(directory, { at: now, state })
  return state
}

async function read(directory: string, collectedAt: number): Promise<GitState | null> {
  const status = await git(directory, ['status', '--porcelain=v2', '--branch', '--no-renames'])
  if (status === null) return null
  const parsed = parseGitStatus(status)
  const log = parsed.oid === null ? null : await git(directory, ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%ct'])
  const head = log === null ? null : parseGitHead(log)
  const changedAt = newestMtime(directory, parsed.files)
  const times = [head?.at ?? null, changedAt].filter((value): value is number => value !== null)

  return {
    path: directory,
    branch: parsed.branch,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    head,
    changed: parsed.changed,
    untracked: parsed.untracked,
    files: parsed.files.slice(0, GIT_FILE_LIMIT),
    lastChangeAt: times.length === 0 ? null : Math.max(...times),
    collectedAt,
  }
}
