// Makes Git usable inside a Dev Container opened on a linked Git worktree.
//
// A linked worktree is held together by two files: `<worktree>/.git`, which points forward at the
// worktree's Git dir, and `<git dir>/gitdir`, which points back at that `.git` file. Three things
// have to hold for Git to work in the container:
//
//   1. the forward link must be RELATIVE — an absolute host path does not exist in the container;
//   2. the back link must be RELATIVE too. An absolute one does not resolve there either, and Git
//      then reports the worktree as prunable: `git worktree prune`, which `git gc` runs on its own,
//      deletes the worktree's admin dir and leaves the checkout unusable;
//   3. the common Git dir must be bind-mounted where that relative forward link lands.
//
// Nothing here guesses paths from strings: the host Git dirs come from `git rev-parse --git-dir`
// and `--git-common-dir`, and the container side is derived from the worktree's own relative link.
// When the mount cannot be established this refuses, so a container is never started on a checkout
// where Git silently points somewhere else.

import { access, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { RUNTIME_IDENTITY } from 'portta-core/taskflow/config'
import { gitRuntimePaths } from 'portta-core/taskflow/paths'
import { type ProcessRunner, runCaptured } from './process-runner.ts'

export interface WorktreeGitMountInput {
  runner: ProcessRunner
  /** The checkout the Dev Container is being opened on. */
  workspacePath: string
  /** Where that checkout appears inside the container (`workspaceFolder`). */
  containerWorkspacePath?: string | undefined
  /** A custom `workspaceMount` from the merged configuration, when the project sets one. */
  workspaceMount?: string | undefined
  /** The configuration being started, for diagnostics. */
  configRef?: string | undefined
}

const PREFLIGHT = 'Dev Container preflight'
/** The file inside a worktree's Git dir that points back at the checkout. */
const BACK_LINK = 'gitdir'

function repairCommand(workspacePath: string): string {
  return `git -C ${workspacePath} worktree repair --relative-paths`
}

function toPosix(value: string): string {
  return sep === '/' ? value : value.replaceAll(sep, '/')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Write through a temporary file in the same directory, so a reader never sees a half-written link. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

interface GitDirs {
  /** The worktree's own Git dir, absolute on the host. */
  gitDir: string
  /** The repository's common Git dir, absolute on the host. */
  commonDir: string
}

async function gitDirs(runner: ProcessRunner, cwd: string): Promise<GitDirs | null> {
  const result = await runCaptured(runner, {
    command: 'git',
    args: ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
    cwd,
  })
  if (result.exit.code !== 0) return null
  const [gitDir, commonDir] = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return gitDir && commonDir ? { gitDir, commonDir } : null
}

/** The `gitdir:` target recorded in a linked worktree's `.git` file, verbatim. */
function linkTarget(content: string): string | null {
  const value = content.trim()
  if (!value.startsWith('gitdir:')) return null
  const target = value.slice('gitdir:'.length).trim()
  return target.length > 0 ? target : null
}

async function worktreeLink(workspacePath: string): Promise<string | null> {
  const content = await readRaw(join(workspacePath, '.git'))
  return content === null ? null : linkTarget(content)
}

/**
 * Whether this worktree is one Portta created. Project worktrees carry Portta's runtime metadata in
 * their Git dir; Workflow Run worktrees record their creation base in their own Git config. Only
 * these are migrated — an imported worktree's links are left to its owner.
 */
async function porttaOwned(runner: ProcessRunner, workspacePath: string, gitDir: string): Promise<boolean> {
  if (await exists(gitRuntimePaths(gitDir).meta)) return true
  const result = await runCaptured(runner, {
    command: 'git',
    args: ['config', '--get', RUNTIME_IDENTITY.gitBaseConfigKey],
    cwd: workspacePath,
  })
  return result.exit.code === 0 && result.stdout.trim().length > 0
}

interface LinkWrite {
  path: string
  previous: string
  next: string
}

type RelinkPlan = { ok: true; writes: LinkWrite[] } | { ok: false; reason: string }

/**
 * What the worktree's two link files must become to be relative.
 *
 * `git worktree repair --relative-paths` would do this, but it sweeps EVERY linked worktree of the
 * repository — verified empirically — and would rewrite the links of worktrees Portta does not own
 * and was not asked about. This plan touches one worktree and refuses on anything unexpected.
 */
async function planRelativeRelink(workspacePath: string, dirs: GitDirs): Promise<RelinkPlan> {
  const forwardPath = join(workspacePath, '.git')
  const backPath = join(dirs.gitDir, BACK_LINK)

  // Git keeps a linked worktree's Git dir at <common dir>/worktrees/<id>. Rebuilding that exact path
  // and comparing is an identity check on what Git reported — not a search through a string.
  if (join(dirs.commonDir, 'worktrees', basename(dirs.gitDir)) !== dirs.gitDir)
    return {
      ok: false,
      reason: `its Git dir ${dirs.gitDir} is not <common dir>/worktrees/<id> under ${dirs.commonDir}`,
    }

  const forward = await readRaw(forwardPath)
  if (forward === null) return { ok: false, reason: `${forwardPath} could not be read` }
  const target = linkTarget(forward)
  if (target === null) return { ok: false, reason: `${forwardPath} does not record a gitdir link` }
  if (resolve(workspacePath, target) !== dirs.gitDir)
    return { ok: false, reason: `${forwardPath} points at ${resolve(workspacePath, target)}, not at ${dirs.gitDir}` }

  const back = await readRaw(backPath)
  if (back === null) return { ok: false, reason: `${backPath} could not be read` }
  if (resolve(dirs.gitDir, back.trim()) !== forwardPath)
    return { ok: false, reason: `${backPath} points at ${resolve(dirs.gitDir, back.trim())}, not at ${forwardPath}` }

  return {
    ok: true,
    writes: [
      { path: forwardPath, previous: forward, next: `gitdir: ${toPosix(relative(workspacePath, dirs.gitDir))}\n` },
      { path: backPath, previous: back, next: `${toPosix(relative(dirs.gitDir, forwardPath))}\n` },
    ],
  }
}

/** Rewrite one worktree's links to relative form. Returns a diagnostic, or null on success. */
async function relinkRelative(runner: ProcessRunner, workspacePath: string, dirs: GitDirs): Promise<string | null> {
  const plan = await planRelativeRelink(workspacePath, dirs)
  if (!plan.ok) return plan.reason

  const written: LinkWrite[] = []
  const restore = async (): Promise<void> => {
    for (const write of written) await writeAtomic(write.path, write.previous).catch(() => {})
  }
  for (const write of plan.writes) {
    try {
      await writeAtomic(write.path, write.next)
      written.push(write)
    } catch (error) {
      await restore()
      return `${write.path} could not be rewritten: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // Prove the worktree still resolves to the same repository before letting a container use it.
  const after = await gitDirs(runner, workspacePath)
  if (!after || after.gitDir !== dirs.gitDir || after.commonDir !== dirs.commonDir) {
    await restore()
    return 'the rewritten links did not resolve back to the same repository, so they were reverted'
  }
  return null
}

/**
 * The extra `devcontainer up` arguments that make Git work inside the container.
 *
 * Returns an empty list when the workspace is not a linked worktree. Throws when the workspace IS a
 * linked worktree and the common Git dir cannot be mounted — starting anyway would hand the agent a
 * checkout whose Git points at nothing, or at the wrong repository.
 */
export async function worktreeGitMountArgs(input: WorktreeGitMountInput): Promise<string[]> {
  const { runner } = input
  // Git reports real paths. Normalising the workspace the same way keeps every comparison and every
  // relative path below honest on systems where the checkout sits behind a symlink.
  const workspacePath = await realpath(input.workspacePath).catch(() => input.workspacePath)
  const dirs = await gitDirs(runner, workspacePath)
  // Not a repository, or the main checkout: the workspace mount already carries the whole `.git`.
  if (!dirs || dirs.gitDir === dirs.commonDir) return []

  const where = input.configRef ? `${workspacePath} (${input.configRef})` : workspacePath

  if (input.workspaceMount) {
    throw new Error(
      `${PREFLIGHT}: ${where} is a linked Git worktree and the configuration sets a custom workspaceMount. ` +
        'The Dev Containers CLI then ignores --mount-git-worktree-common-dir (devcontainers/cli#1243), so the ' +
        'Git common dir cannot be mounted and Git would not work inside the container. Remove workspaceMount ' +
        'from the Dev Container configuration, or open this configuration from the main checkout.',
    )
  }

  let link = await worktreeLink(workspacePath)
  const backLink = await readRaw(join(dirs.gitDir, BACK_LINK))
  if ((link !== null && isAbsolute(link)) || (backLink !== null && isAbsolute(backLink.trim()))) {
    if (!(await porttaOwned(runner, workspacePath, dirs.gitDir))) {
      throw new Error(
        `${PREFLIGHT}: the Git worktree at ${where} is linked with an absolute gitdir, which does not exist ` +
          'inside a container. Portta did not create this worktree and will not rewrite its links. ' +
          `Migrate it explicitly with: ${repairCommand(workspacePath)}`,
      )
    }
    const failure = await relinkRelative(runner, workspacePath, dirs)
    if (failure !== null) {
      throw new Error(
        `${PREFLIGHT}: the Git worktree at ${where} is linked with an absolute gitdir and could not be ` +
          `migrated to relative links: ${failure}. Run: ${repairCommand(workspacePath)}`,
      )
    }
    link = await worktreeLink(workspacePath)
  }

  if (link === null || isAbsolute(link)) {
    throw new Error(
      `${PREFLIGHT}: the Git worktree at ${where} has no relative gitdir link, so the Git common dir cannot ` +
        `be mounted into the container. Run: ${repairCommand(workspacePath)}`,
    )
  }

  const containerWorkspacePath = input.containerWorkspacePath
  if (!containerWorkspacePath) {
    throw new Error(
      `${PREFLIGHT}: the container workspace folder for ${where} is unknown, so the Git common dir of this ` +
        'linked worktree cannot be mounted into the container.',
    )
  }

  const up = toPosix(relative(dirs.gitDir, dirs.commonDir))
  // Git always keeps a linked worktree's Git dir under <common dir>/worktrees/<id>. If that does not
  // hold, the container side of the link cannot be derived and we refuse rather than guess.
  if (up.length === 0 || up.split('/').some((segment) => segment !== '..')) {
    throw new Error(
      `${PREFLIGHT}: the Git common dir ${dirs.commonDir} does not contain the worktree Git dir ${dirs.gitDir}, ` +
        `so it cannot be mapped into the container for ${where}.`,
    )
  }

  const containerGitDir = posix.resolve(containerWorkspacePath, toPosix(link))
  const containerCommonDir = posix.resolve(containerGitDir, up)
  return [
    '--mount-git-worktree-common-dir',
    '--mount',
    `type=bind,source=${dirs.commonDir},target=${containerCommonDir}`,
  ]
}
