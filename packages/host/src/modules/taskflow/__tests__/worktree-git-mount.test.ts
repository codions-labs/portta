import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { NodeProcessRunner } from '../adapters/process-runner.ts'
import { worktreeGitMountArgs } from '../adapters/worktree-git-mount.ts'

const exec = promisify(execFile)
const runner = new NodeProcessRunner()
/** A container workspace folder deep enough for the relative gitdir chain to stay meaningful. */
const CONTAINER_WORKSPACE = '/workspaces/a/b/c/wt'

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout.trim()
}

let root = ''
let repo = ''

async function makeRepo(): Promise<string> {
  const dir = join(root, 'main')
  await mkdir(dir)
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 't@t.t'])
  await git(dir, ['config', 'user.name', 't'])
  await git(dir, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'a.txt'), 'hello\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

/** A worktree at <repo>/.portta/worktrees/<name>, with the link policy under test. */
async function addWorktree(name: string, relativePaths: boolean): Promise<string> {
  const path = join(repo, '.portta', 'worktrees', name)
  await git(repo, ['worktree', 'add', ...(relativePaths ? ['--relative-paths'] : []), '--detach', path, 'HEAD'])
  return path
}

/** Mark a worktree as one Portta created, the way a Workflow Run does. */
async function markOwned(worktreePath: string): Promise<void> {
  await git(worktreePath, ['config', 'taskflow.base', await git(repo, ['rev-parse', 'HEAD'])])
}

/** <worktree>/.git — the link forward to the worktree's Git dir. */
async function forwardLink(worktreePath: string): Promise<string> {
  return (await readFile(join(worktreePath, '.git'), 'utf8')).trim()
}

/** <common>/worktrees/<name>/gitdir — the link back to the checkout. */
function backLinkPath(name: string): string {
  return join(repo, '.git', 'worktrees', name, 'gitdir')
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'taskflow-worktree-git-mount-')))
  repo = await makeRepo()
})

describe('worktreeGitMountArgs', () => {
  it('asks for no Git mount on the main checkout', async () => {
    await expect(
      worktreeGitMountArgs({ runner, workspacePath: repo, containerWorkspacePath: '/workspaces/main' }),
    ).resolves.toEqual([])
  })

  it('mounts the common Git dir where a relatively linked worktree resolves it inside the container', async () => {
    const worktree = await addWorktree('wt', true)
    await expect(
      worktreeGitMountArgs({ runner, workspacePath: worktree, containerWorkspacePath: CONTAINER_WORKSPACE }),
    ).resolves.toEqual([
      '--mount-git-worktree-common-dir',
      '--mount',
      `type=bind,source=${join(repo, '.git')},target=/workspaces/a/.git`,
    ])
  })

  it('rewrites an absolute link on a Workflow Run worktree to relative, in both directions, and then mounts it', async () => {
    const worktree = await addWorktree('wt', false)
    await markOwned(worktree)
    expect(await forwardLink(worktree)).toBe(`gitdir: ${join(repo, '.git', 'worktrees', 'wt')}`)

    const args = await worktreeGitMountArgs({
      runner,
      workspacePath: worktree,
      containerWorkspacePath: CONTAINER_WORKSPACE,
    })

    expect(await forwardLink(worktree)).toBe('gitdir: ../../../.git/worktrees/wt')
    // The back link matters too: an absolute one does not resolve in the container, and Git then
    // treats the worktree as prunable — `git gc` would delete its admin dir.
    expect((await readFile(backLinkPath('wt'), 'utf8')).trim()).toBe('../../../.portta/worktrees/wt/.git')
    expect(await git(repo, ['worktree', 'list', '--porcelain'])).not.toContain('prunable')
    expect(args).toEqual([
      '--mount-git-worktree-common-dir',
      '--mount',
      `type=bind,source=${join(repo, '.git')},target=/workspaces/a/.git`,
    ])
  })

  it('rewrites an absolute link on a project worktree that carries Portta runtime metadata', async () => {
    const worktree = await addWorktree('wt', false)
    const gitDir = await git(worktree, ['rev-parse', '--path-format=absolute', '--git-dir'])
    await mkdir(join(gitDir, 'portta'), { recursive: true })
    await writeFile(join(gitDir, 'portta', 'meta.json'), '{}')

    await expect(
      worktreeGitMountArgs({ runner, workspacePath: worktree, containerWorkspacePath: CONTAINER_WORKSPACE }),
    ).resolves.toContain('--mount-git-worktree-common-dir')
    expect(await forwardLink(worktree)).toBe('gitdir: ../../../.git/worktrees/wt')
  })

  it('rewrites only the worktree being started and leaves a foreign worktree byte-identical', async () => {
    const owned = await addWorktree('own', false)
    const foreign = await addWorktree('ext', false)
    await markOwned(owned)
    const foreignForward = await readFile(join(foreign, '.git'))
    const foreignBack = await readFile(backLinkPath('ext'))

    await worktreeGitMountArgs({ runner, workspacePath: owned, containerWorkspacePath: CONTAINER_WORKSPACE })

    expect(await readFile(join(foreign, '.git'))).toEqual(foreignForward)
    expect(await readFile(backLinkPath('ext'))).toEqual(foreignBack)
    expect(await forwardLink(owned)).toBe('gitdir: ../../../.git/worktrees/own')
  })

  it('refuses a worktree Portta does not own instead of rewriting its links', async () => {
    const worktree = await addWorktree('wt', false)
    const forward = await readFile(join(worktree, '.git'))
    const back = await readFile(backLinkPath('wt'))

    await expect(
      worktreeGitMountArgs({ runner, workspacePath: worktree, containerWorkspacePath: CONTAINER_WORKSPACE }),
    ).rejects.toThrow(/absolute gitdir[\s\S]*worktree repair --relative-paths/)
    expect(await readFile(join(worktree, '.git'))).toEqual(forward)
    expect(await readFile(backLinkPath('wt'))).toEqual(back)
  })

  it('refuses instead of guessing when the link files are not what Git reported', async () => {
    const worktree = await addWorktree('wt', false)
    await markOwned(worktree)
    await writeFile(backLinkPath('wt'), '/somewhere/else/.git\n')

    await expect(
      worktreeGitMountArgs({ runner, workspacePath: worktree, containerWorkspacePath: CONTAINER_WORKSPACE }),
    ).rejects.toThrow(/could not be migrated to relative links[\s\S]*points at/)
  })

  it('refuses a worktree whose configuration sets a custom workspaceMount', async () => {
    const worktree = await addWorktree('wt', true)

    await expect(
      worktreeGitMountArgs({
        runner,
        workspacePath: worktree,
        containerWorkspacePath: CONTAINER_WORKSPACE,
        workspaceMount: 'source=/host/checkout,target=/app,type=bind',
        configRef: '.devcontainer/devcontainer.json',
      }),
    ).rejects.toThrow(/workspaceMount[\s\S]*devcontainers\/cli#1243/)
  })

  it('refuses a linked worktree when the container workspace folder is unknown', async () => {
    const worktree = await addWorktree('wt', true)

    await expect(worktreeGitMountArgs({ runner, workspacePath: worktree })).rejects.toThrow(
      /container workspace folder .* is unknown/,
    )
  })
})
