import { spawnSync } from 'node:child_process'
import { readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * Canonicalize a filesystem path for equality checks.
 *
 * Git porcelain and `rev-parse --show-toplevel` follow realpaths, so on macOS a
 * fixture under `os.tmpdir()` (`/var/folders/...`) comes back as
 * `/private/var/folders/...`. `path.resolve` does not follow that symlink.
 * When the leaf is missing (stale worktree registration), walk up to the first
 * existing ancestor so deleted paths still compare.
 */
export function canonicalizeFsPath(input: string): string {
  const resolved = resolve(input)
  try {
    return realpathSync(resolved)
  } catch {
    const missing: string[] = []
    let current = resolved
    while (current !== dirname(current)) {
      missing.unshift(basename(current))
      current = dirname(current)
      try {
        return join(realpathSync(current), ...missing)
      } catch {}
    }
    return resolved
  }
}

/** True when both paths name the same location after symlink resolution. */
export function sameFsPath(left: string, right: string): boolean {
  return canonicalizeFsPath(left) === canonicalizeFsPath(right)
}

export interface GitWorktreeEntry {
  path: string
  branch: string | null
  head: string | null
  detached: boolean
  bare: boolean
}

export type CreateWorktreeMode = 'new' | 'existing'

interface BaseCreateGitWorktreeOptions {
  repoRoot: string
  worktreePath: string
  branch: string
}

export interface CreateNewGitWorktreeOptions extends BaseCreateGitWorktreeOptions {
  mode: 'new'
  baseBranch?: string
}

export interface CreateExistingGitWorktreeOptions extends BaseCreateGitWorktreeOptions {
  mode: 'existing'
  startPoint?: string
}

export type CreateGitWorktreeOptions = CreateNewGitWorktreeOptions | CreateExistingGitWorktreeOptions

export interface RemoveGitWorktreeOptions {
  repoRoot: string
  worktreePath: string
  force?: boolean
}

export interface MergeGitBranchOptions {
  repoRoot: string
  sourceBranch: string
  targetBranch: string
}

export interface GitWorktreeStatus {
  dirty: boolean
  aheadCount: number
  currentCommit: string | null
}

export interface UnpushedCommit {
  hash: string
  message: string
}

export type TryGitCommandResult = { ok: true; stdout: string } | { ok: false; stderr: string }

export interface RemoveGitWorktreeDeps {
  tryRunGit?: (args: string[], cwd: string) => TryGitCommandResult
  listWorktrees?: (cwd: string) => GitWorktreeEntry[]
  removeDirectory?: (path: string) => void
}

export interface GitGateway {
  resolveRepoRoot(dir: string): string | null
  resolveWorktreeRoot(cwd: string): string
  resolveWorktreeGitDir(cwd: string): string
  listWorktrees(cwd: string): GitWorktreeEntry[]
  listLiveWorktrees(cwd: string): GitWorktreeEntry[]
  listLocalBranches(cwd: string): string[]
  listRemoteBranches(cwd: string): string[]
  readWorktreeStatus(cwd: string): GitWorktreeStatus
  readStatus(cwd: string): string
  createWorktree(opts: CreateGitWorktreeOptions): void
  removeWorktree(opts: RemoveGitWorktreeOptions): void
  deleteBranch(repoRoot: string, branch: string, force?: boolean): void
  mergeBranch(opts: MergeGitBranchOptions): void
  currentBranch(repoRoot: string): string
  resolveCommit(cwd: string, ref: string): string
  createAndSwitchBranch(cwd: string, branch: string, startPoint: string): void
  readDiff(cwd: string): string
  listUnpushedCommits(cwd: string): UnpushedCommit[]
  countUnsavedCommits(cwd: string, baseBranch: string): number
  fetchBranch(repoRoot: string, remote: string, branch: string): TryGitCommandResult
  fastForwardMerge(repoRoot: string, ref: string): TryGitCommandResult
  hardReset(repoRoot: string, ref: string): TryGitCommandResult
}

interface GitProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

function spawnGit(args: string[], cwd: string): { ok: true; result: GitProcessResult } | { ok: false; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    return { ok: false, stderr: `spawn error (cwd=${cwd}): ${errorMessage(result.error)}` }
  }
  return {
    ok: true,
    result: {
      exitCode: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    },
  }
}

function runGit(args: string[], cwd: string): string {
  const spawned = spawnGit(args, cwd)
  if (!spawned.ok) {
    throw new Error(`git ${args.join(' ')} failed: ${spawned.stderr}`)
  }
  const { result } = spawned

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(`git ${args.join(' ')} failed: ${stderr || `exit ${result.exitCode}`}`)
  }

  return result.stdout.trim()
}

function tryRunGit(args: string[], cwd: string): TryGitCommandResult {
  const spawned = spawnGit(args, cwd)
  if (!spawned.ok) {
    return { ok: false, stderr: spawned.stderr }
  }
  const { result } = spawned

  if (result.exitCode !== 0) {
    return {
      ok: false,
      stderr: result.stderr.trim(),
    }
  }

  return {
    ok: true,
    stdout: result.stdout.trim(),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRegisteredWorktree(entries: GitWorktreeEntry[], worktreePath: string): boolean {
  return entries.some((entry) => sameFsPath(entry.path, worktreePath))
}

function removeDirectory(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
  })
}

function currentCheckoutRef(cwd: string): { ref: string; branch: string | null } {
  const symbolicRef = tryRunGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)
  if (symbolicRef.ok && symbolicRef.stdout.length > 0) {
    return {
      ref: symbolicRef.stdout,
      branch: symbolicRef.stdout,
    }
  }

  return {
    ref: runGit(['rev-parse', '--verify', 'HEAD'], cwd),
    branch: null,
  }
}

/**
 * Resolve the git repo root for a directory. If `dir` is already inside a git
 * repo, returns its toplevel. If not (e.g. a worktree-root container), scans
 * immediate children for a git worktree and resolves the main repo from there.
 * Returns null when no repo can be found.
 */
export function resolveRepoRoot(dir: string): string | null {
  const direct = tryRunGit(['rev-parse', '--show-toplevel'], dir)
  if (direct.ok) return resolve(dir, direct.stdout)

  // dir is not a git repo — check if it's a worktree container
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const entry of entries) {
    const child = join(dir, entry)
    try {
      if (!statSync(child).isDirectory()) continue
    } catch {
      continue
    }
    const childResult = tryRunGit(['rev-parse', '--show-toplevel'], child)
    if (childResult.ok) return resolve(child, childResult.stdout)
  }
  return null
}

export function resolveWorktreeRoot(cwd: string): string {
  const output = runGit(['rev-parse', '--show-toplevel'], cwd)
  return resolve(cwd, output)
}

export function resolveWorktreeGitDir(cwd: string): string {
  const output = runGit(['rev-parse', '--git-dir'], cwd)
  return resolve(cwd, output)
}

export function parseGitWorktreePorcelain(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let current: GitWorktreeEntry | null = null

  const flush = (): void => {
    if (current?.path) entries.push(current)
    current = null
  }

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) {
      flush()
      continue
    }

    if (line.startsWith('worktree ')) {
      flush()
      current = {
        path: line.slice('worktree '.length),
        branch: null,
        head: null,
        detached: false,
        bare: false,
      }
      continue
    }

    if (!current) continue

    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
      continue
    }

    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
      continue
    }

    if (line === 'detached') {
      current.detached = true
      continue
    }

    if (line === 'bare') {
      current.bare = true
    }
  }

  flush()
  return entries
}

export function listGitWorktrees(cwd: string): GitWorktreeEntry[] {
  const output = runGit(['worktree', 'list', '--porcelain'], cwd)
  return parseGitWorktreePorcelain(output)
}

export function worktreeEntryPathExists(entry: GitWorktreeEntry): boolean {
  try {
    return statSync(entry.path).isDirectory()
  } catch {
    return false
  }
}

export function filterLiveWorktreeEntries(entries: GitWorktreeEntry[]): GitWorktreeEntry[] {
  return entries.filter(worktreeEntryPathExists)
}

export function listLocalGitBranches(cwd: string): string[] {
  const output = runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd)
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function listRemoteGitBranches(cwd: string): string[] {
  try {
    runGit(['fetch', '--prune', 'origin'], cwd)
  } catch {
    // Fetch failed (e.g. no network) — list whatever is cached locally
  }
  const output = runGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], cwd)
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^origin\//, ''))
      // Defensive: some repos expose a bare symbolic `origin` ref alongside origin/*.
      .filter((name) => name !== 'HEAD' && name !== 'origin')
  )
}

export function readGitWorktreeStatus(cwd: string): GitWorktreeStatus {
  const dirtyOutput = runGit(['status', '--porcelain'], cwd)
  const commit = tryRunGit(['rev-parse', 'HEAD'], cwd)
  let ahead = tryRunGit(['rev-list', '--count', '@{upstream}..HEAD'], cwd)
  if (!ahead.ok) {
    // Fallback: counts commits not on any origin/* branch. May slightly over-count
    // on repos with many branches, but is a reasonable default when no upstream is set.
    ahead = tryRunGit(['rev-list', '--count', 'HEAD', '--not', '--remotes=origin'], cwd)
  }

  return {
    dirty: dirtyOutput.length > 0,
    aheadCount: ahead.ok ? parseInt(ahead.stdout, 10) || 0 : 0,
    currentCommit: commit.ok && commit.stdout.length > 0 ? commit.stdout : null,
  }
}

export function removeGitWorktree(opts: RemoveGitWorktreeOptions, deps: RemoveGitWorktreeDeps = {}): void {
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(opts.worktreePath)

  const result = (deps.tryRunGit ?? tryRunGit)(args, opts.repoRoot)
  if (result.ok) {
    return
  }

  const failure = `git ${args.join(' ')} failed: ${result.stderr || 'exit 1'}`
  const remainingWorktrees = (deps.listWorktrees ?? listGitWorktrees)(opts.repoRoot)
  if (isRegisteredWorktree(remainingWorktrees, opts.worktreePath)) {
    throw new Error(failure)
  }

  try {
    ;(deps.removeDirectory ?? removeDirectory)(opts.worktreePath)
  } catch (error) {
    throw new Error(`${failure}; cleanup failed: ${errorMessage(error)}`)
  }
}

export class NodeGitGateway implements GitGateway {
  resolveRepoRoot(dir: string): string | null {
    return resolveRepoRoot(dir)
  }

  resolveWorktreeRoot(cwd: string): string {
    return resolveWorktreeRoot(cwd)
  }

  resolveWorktreeGitDir(cwd: string): string {
    return resolveWorktreeGitDir(cwd)
  }

  listWorktrees(cwd: string): GitWorktreeEntry[] {
    return listGitWorktrees(cwd)
  }

  listLiveWorktrees(cwd: string): GitWorktreeEntry[] {
    return filterLiveWorktreeEntries(listGitWorktrees(cwd))
  }

  listLocalBranches(cwd: string): string[] {
    return listLocalGitBranches(cwd)
  }

  listRemoteBranches(cwd: string): string[] {
    return listRemoteGitBranches(cwd)
  }

  readWorktreeStatus(cwd: string): GitWorktreeStatus {
    return readGitWorktreeStatus(cwd)
  }

  readStatus(cwd: string): string {
    return runGit(['status', '--short', '--untracked-files=all'], cwd)
  }

  createWorktree(opts: CreateGitWorktreeOptions): void {
    const args = ['worktree', 'add', '--relative-paths']
    if (opts.mode === 'new') {
      args.push('-b', opts.branch, opts.worktreePath)
      if (opts.baseBranch) args.push(opts.baseBranch)
    } else {
      if (opts.startPoint) {
        args.push('-b', opts.branch, opts.worktreePath, opts.startPoint)
      } else {
        args.push(opts.worktreePath, opts.branch)
      }
    }
    runGit(args, opts.repoRoot)
  }

  removeWorktree(opts: RemoveGitWorktreeOptions): void {
    removeGitWorktree(opts)
  }

  deleteBranch(repoRoot: string, branch: string, force = false): void {
    runGit(['branch', force ? '-D' : '-d', branch], repoRoot)
  }

  mergeBranch(opts: MergeGitBranchOptions): void {
    const current = currentCheckoutRef(opts.repoRoot)
    const shouldRestore = current.branch !== opts.targetBranch
    if (shouldRestore) {
      runGit(['checkout', opts.targetBranch], opts.repoRoot)
    }

    let mergeError: string | null = null
    const cleanupErrors: string[] = []

    try {
      runGit(['merge', '--no-ff', '--no-edit', opts.sourceBranch], opts.repoRoot)
    } catch (error) {
      mergeError = errorMessage(error)

      const abort = tryRunGit(['merge', '--abort'], opts.repoRoot)
      if (!abort.ok && abort.stderr.length > 0 && !abort.stderr.includes('MERGE_HEAD missing')) {
        cleanupErrors.push(`merge abort failed: ${abort.stderr}`)
      }
    }

    if (shouldRestore) {
      const restore = tryRunGit(['checkout', current.ref], opts.repoRoot)
      if (!restore.ok) {
        cleanupErrors.push(`restore checkout failed: ${restore.stderr}`)
      }
    }

    if (mergeError) {
      const suffix = cleanupErrors.length > 0 ? `; ${cleanupErrors.join('; ')}` : ''
      throw new Error(`${mergeError}${suffix}`)
    }
    if (cleanupErrors.length > 0) {
      throw new Error(cleanupErrors.join('; '))
    }
  }

  currentBranch(repoRoot: string): string {
    return runGit(['branch', '--show-current'], repoRoot)
  }

  resolveCommit(cwd: string, ref: string): string {
    return runGit(['rev-parse', '--verify', `${ref}^{commit}`], cwd)
  }

  createAndSwitchBranch(cwd: string, branch: string, startPoint: string): void {
    runGit(['switch', '--create', branch, startPoint], cwd)
  }

  readDiff(cwd: string): string {
    const result = tryRunGit(['diff', 'HEAD', '--no-color'], cwd)
    return result.ok ? result.stdout : ''
  }

  /**
   * Commits reachable from HEAD and from nothing else that would survive this
   * worktree: not on an origin branch, not on the project's main branch. It
   * answers "would deleting this branch lose work", which `aheadCount` cannot:
   * with no upstream and no remote at all, every commit counts as ahead.
   */
  countUnsavedCommits(cwd: string, baseBranch: string): number {
    const count = (args: string[]): number | null => {
      const result = tryRunGit(args, cwd)
      return result.ok ? parseInt(result.stdout, 10) || 0 : null
    }
    const excludingBase = baseBranch
      ? count(['rev-list', '--count', 'HEAD', '--not', '--remotes=origin', baseBranch])
      : null
    if (excludingBase !== null) return excludingBase
    // The main branch may not exist locally; the remotes alone still answer it.
    return count(['rev-list', '--count', 'HEAD', '--not', '--remotes=origin']) ?? 0
  }

  listUnpushedCommits(cwd: string): UnpushedCommit[] {
    let result = tryRunGit(['log', '--oneline', '@{upstream}..HEAD'], cwd)
    if (!result.ok) {
      // Fallback: see comment in readGitWorktreeStatus for trade-off
      result = tryRunGit(['log', '--oneline', 'HEAD', '--not', '--remotes=origin'], cwd)
    }
    if (!result.ok || !result.stdout) return []
    return result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const spaceIdx = line.indexOf(' ')
        return {
          hash: line.slice(0, spaceIdx),
          message: line.slice(spaceIdx + 1),
        }
      })
  }

  fetchBranch(repoRoot: string, remote: string, branch: string): TryGitCommandResult {
    return tryRunGit(['fetch', remote, branch], repoRoot)
  }

  fastForwardMerge(repoRoot: string, ref: string): TryGitCommandResult {
    return tryRunGit(['merge', '--ff-only', ref], repoRoot)
  }

  hardReset(repoRoot: string, ref: string): TryGitCommandResult {
    return tryRunGit(['reset', '--hard', ref], repoRoot)
  }
}
