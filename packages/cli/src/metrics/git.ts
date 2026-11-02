// Where a project's code stands, read where the code is.
//
// The panel never opens a project's folder; the collector runs on the host and does.
// Read-only and local on purpose: nothing here fetches, pulls or asks a remote
// anything, so `ahead` and `behind` are as of the last fetch somebody did.
//
// The directory comes from a label any container can carry, so git is held on a
// short lead: no optional locks (it must not write the index), no prompts, no
// fsmonitor (a repository can name a command there) and no hooks path.

import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { GitState } from 'portta-contracts'
import { composeProjectOf, GIT_FILE_LIMIT, parseGitHead, parseGitStatus, repositoryRunsCommands } from 'portta-core'
import { runProcess } from '../process.js'

const TIMEOUT_MS = 5_000
const CACHE_MS = 30_000
const MTIME_FILES = 50

const cache = new Map<string, { at: number; state: GitState | null }>()

async function git(directory: string, args: readonly string[]): Promise<string | null> {
  const result = await runProcess(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'safe.bareRepository=explicit',
      '-c',
      'log.showSignature=false',
      '-c',
      'protocol.allow=never',
      '-C',
      directory,
      ...args,
    ],
    {
      reject: false,
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_LAZY_FETCH: '1',
        LC_ALL: 'C',
      },
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

/**
 * The folder each compose project was started from, when it can be trusted to be one.
 *
 * The label is written by whoever started the container, so it is not taken at its word: a
 * project whose containers disagree has none, a path inside Portta's own installation has
 * none, and one this user does not own has none, which is also git's own rule for a repository.
 */
export function workingDirectories(
  identities: ReadonlyArray<{ labels: Record<string, string> }>,
  root: string,
  uid: number | undefined = process.getuid?.(),
): Map<string, string> {
  const claimed = new Map<string, Set<string>>()
  for (const { labels } of identities) {
    const project = composeProjectOf(labels)
    const directory = labels['com.docker.compose.project.working_dir']
    if (!project || !directory) continue
    claimed.set(project, (claimed.get(project) ?? new Set()).add(directory))
  }
  const trusted = new Map<string, string>()
  for (const [project, directories] of claimed) {
    const [only] = directories
    if (directories.size !== 1 || !only || !isAbsolute(only)) continue
    try {
      const real = realpathSync(only)
      const inside = relative(realpathSync(root), real)
      if (inside === '' || (!inside.startsWith('..') && !inside.startsWith(sep))) continue
      if (uid !== undefined && statSync(real).uid !== uid) continue
      trusted.set(project, real)
    } catch {
      // Not there on this host: nothing to read.
    }
  }
  return trusted
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
  // Before anything that could run what the repository names: its own settings, not the owner's.
  const config = await git(directory, ['config', '--list', '--show-scope'])
  if (config === null || repositoryRunsCommands(config)) return null
  const status = await git(directory, [
    'status',
    '--porcelain=v2',
    '--branch',
    '--no-renames',
    '--ignore-submodules=all',
  ])
  if (status === null) return null
  const parsed = parseGitStatus(status)
  const log =
    parsed.oid === null
      ? null
      : await git(directory, ['log', '-1', '--no-show-signature', '--format=%h%x1f%s%x1f%an%x1f%ct'])
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
