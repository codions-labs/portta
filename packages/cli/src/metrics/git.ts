// Where a project's code stands, read where the code is.
//
// The panel never opens a project's folder; the collector runs on the host and does.
// Read-only and local on purpose: nothing here fetches, pulls or asks a remote
// anything, so `ahead` and `behind` are as of the last fetch somebody did.
//
// The directory comes from a label any container can carry, so git is held on a
// short lead: no optional locks (it must not write the index), no prompts, no
// fsmonitor (a repository can name a command there) and no hooks path.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { GitState } from 'portta-contracts'
import { composeProjectOf, GIT_FILE_LIMIT, parseGitHead, parseGitStatus, repositoryRunsCommands } from 'portta-core'
import { runProcess } from '../process.js'

const TIMEOUT_MS = 5_000
const CACHE_MS = 30_000
const MTIME_FILES = 50

const cache = new Map<string, { at: number; state: GitState | null }>()

async function git(view: View, args: readonly string[]): Promise<string | null> {
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
      `--git-dir=${view.gitDir}`,
      `--work-tree=${view.directory}`,
      '-C',
      view.directory,
      ...args,
    ],
    {
      reject: false,
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        // A file called `src/*` is that file, not every file under src.
        GIT_LITERAL_PATHSPECS: '1',
        // Objects come from this repository only, never from another one it was told to borrow from.
        GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
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
 * Compose also records the files it read, so the folder must hold them, and a folder that two
 * projects both name is given to neither. These catch a label that is wrong or careless; they are
 * not proof of who wrote it, which only a record Portta made itself could be.
 * Where the collector cannot tell who it runs as, nothing is trusted.
 */
export function workingDirectories(
  identities: ReadonlyArray<{ labels: Record<string, string> }>,
  root: string,
  uid: number | null = process.getuid?.() ?? null,
): Map<string, string> {
  if (uid === null) return new Map()
  const claimed = new Map<string, Set<string>>()
  const files = new Map<string, Set<string>>()
  for (const { labels } of identities) {
    const project = composeProjectOf(labels)
    const directory = labels['com.docker.compose.project.working_dir']
    if (!project || !directory) continue
    claimed.set(project, (claimed.get(project) ?? new Set()).add(directory))
    const named = files.get(project) ?? new Set()
    for (const file of (labels['com.docker.compose.project.config_files'] ?? '').split(',')) {
      if (file !== '') named.add(file)
    }
    files.set(project, named)
  }
  // A folder two projects both name is claimed by at least one that did not start there. Counted
  // by where the name really leads, so a link or a trailing slash does not make it two folders.
  const resolved = new Map<string, string | null>()
  const resolve = (directory: string): string | null => {
    if (!resolved.has(directory)) {
      try {
        resolved.set(directory, isAbsolute(directory) ? realpathSync(directory) : null)
      } catch {
        resolved.set(directory, null)
      }
    }
    return resolved.get(directory) ?? null
  }
  const claims = new Map<string, number>()
  for (const directories of claimed.values()) {
    for (const real of new Set([...directories].map(resolve))) {
      if (real !== null) claims.set(real, (claims.get(real) ?? 0) + 1)
    }
  }
  const trusted = new Map<string, string>()
  for (const [project, directories] of claimed) {
    const [only] = directories
    if (directories.size !== 1 || !only || !isAbsolute(only)) continue
    try {
      const real = realpathSync(only)
      if (claims.get(real) !== 1) continue
      const inside = relative(realpathSync(root), real)
      if (inside === '' || (!inside.startsWith('..') && !inside.startsWith(sep))) continue
      if (statSync(real).uid !== uid) continue
      if (!holdsComposeFiles(real, files.get(project))) continue
      trusted.set(project, real)
    } catch {
      // Not there on this host: nothing to read.
    }
  }
  return trusted
}

/** Every file the project's containers say Compose read is there, and inside the folder. */
function holdsComposeFiles(directory: string, named: ReadonlySet<string> | undefined): boolean {
  if (!named || named.size === 0) return false
  for (const file of named) {
    if (!isAbsolute(file)) return false
    const inside = relative(directory, realpathSync(file))
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return false
  }
  return true
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

interface View {
  /** The folder the work tree is. */
  directory: string
  /** A private repository directory: the real one's data, and a copy of its configuration that was checked. */
  gitDir: string
}

const CONFIG_LIMIT = 64 * 1024
const HEAD_LIMIT = 4 * 1024

/**
 * A small regular file of this user's, read through the descriptor that was checked.
 *
 * Not a link (a project could make one to something large or secret), not a pipe, and never
 * more than `limit` bytes: what is read is what was opened, so nothing swaps in after the check.
 */
function readSmallFile(path: string, limit: number, uid: number | undefined): Buffer | null {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return null
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > limit || (uid !== undefined && info.uid !== uid)) return null
    const buffer = Buffer.alloc(limit + 1)
    const read = readSync(fd, buffer, 0, limit + 1, 0)
    return read > limit ? null : buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/**
 * A directory git can read the repository through without trusting the one in the project.
 *
 * Checking the project's `.git/config` and then letting git read it again leaves a gap in which
 * a container that can write there changes it, so git is pointed at a copy made once and
 * checked, and the rest (HEAD, index, refs, objects) is linked in. Null for anything but a plain
 * `.git` folder of this user's: a linked work tree or a submodule has its repository elsewhere.
 */
function privateView(directory: string, uid: number | undefined): View | null {
  const real = join(directory, '.git')
  const info = lstatSync(real, { throwIfNoEntry: false })
  if (!info?.isDirectory() || (uid !== undefined && info.uid !== uid)) return null
  const config = readSmallFile(join(real, 'config'), CONFIG_LIMIT, uid)
  const head = readSmallFile(join(real, 'HEAD'), HEAD_LIMIT, uid)
  if (!config || !head) return null
  const gitDir = mkdtempSync(join(tmpdir(), 'portta-git-'))
  try {
    writeFileSync(join(gitDir, 'config'), config, { mode: 0o600 })
    // HEAD is copied, not linked: git reads a linked HEAD as an old-style symbolic ref.
    writeFileSync(join(gitDir, 'HEAD'), head, { mode: 0o600 })
    // What the owner excluded for themselves, and nobody else: copied through the same checked read.
    // A repository that borrows objects from somewhere else would show that somewhere else's content.
    if (lstatSync(join(real, 'objects', 'info', 'alternates'), { throwIfNoEntry: false })) {
      rmSync(gitDir, { recursive: true, force: true })
      return null
    }
    const excludePath = join(real, 'info', 'exclude')
    const exclude = readSmallFile(excludePath, CONFIG_LIMIT, uid)
    // One that is there and cannot be read safely (too large, a link, not the owner's) is not a
    // reason to carry on without it: what it hides would be published as if nobody had hidden it.
    if (exclude === null && lstatSync(excludePath, { throwIfNoEntry: false })) {
      rmSync(gitDir, { recursive: true, force: true })
      return null
    }
    if (exclude) {
      mkdirSync(join(gitDir, 'info'), { mode: 0o700 })
      writeFileSync(join(gitDir, 'info', 'exclude'), exclude, { mode: 0o600 })
    }
    for (const name of ['index', 'refs', 'objects', 'packed-refs', 'shallow']) {
      if (lstatSync(join(real, name), { throwIfNoEntry: false })) symlinkSync(join(real, name), join(gitDir, name))
    }
    return { directory, gitDir }
  } catch {
    rmSync(gitDir, { recursive: true, force: true })
    return null
  }
}

async function read(directory: string, collectedAt: number): Promise<GitState | null> {
  let view: View | null = null
  try {
    view = privateView(directory, process.getuid?.())
  } catch {
    return null
  }
  if (!view) return null
  try {
    return await readThrough(view, collectedAt)
  } finally {
    rmSync(view.gitDir, { recursive: true, force: true })
  }
}

async function readThrough(view: View, collectedAt: number): Promise<GitState | null> {
  const { directory } = view
  // Before anything that could run what the repository names: the copy git will read, not the owner's.
  const config = await git(view, ['config', '--file', join(view.gitDir, 'config'), '--list', '-z'])
  if (config === null || repositoryRunsCommands(config)) return null
  const status = await git(view, ['status', '--porcelain=v2', '--branch', '--no-renames', '--ignore-submodules=all'])
  if (status === null) return null
  const parsed = parseGitStatus(status)
  const log =
    parsed.oid === null
      ? null
      : await git(view, ['log', '-1', '--no-show-signature', '--format=%h%x1f%s%x1f%an%x1f%ct'])
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

/**
 * Runs git on a project's folder the way `readGit` does, for the callers that need more than the
 * summary. Null when the folder is not a repository git may read, which includes one whose own
 * configuration names a command; otherwise whatever `use` returns. The private copy of the
 * repository's configuration is removed afterwards.
 */
export async function withRepository<T>(
  directory: string,
  use: (run: (args: readonly string[]) => Promise<string | null>) => Promise<T>,
): Promise<T | null> {
  if (!isAbsolute(directory) || directory.includes('\0')) return null
  let view: View | null = null
  try {
    view = privateView(directory, process.getuid?.())
  } catch {
    return null
  }
  if (!view) return null
  const open = view
  try {
    const config = await git(open, ['config', '--file', join(open.gitDir, 'config'), '--list', '-z'])
    if (config === null || repositoryRunsCommands(config)) return null
    return await use((args) => git(open, args))
  } finally {
    rmSync(open.gitDir, { recursive: true, force: true })
  }
}
