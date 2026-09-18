import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFlow } from './test-support.ts'

const tempDirs: string[] = []
const decoder = new TextDecoder()
// The real `portta` program.
const porttaEntry = join(dirname(fileURLToPath(import.meta.url)), '../../cli.ts')
const tsxLoader = new URL('../../../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href

function runOrThrow(cmd: string[], cwd: string): void {
  const result = nodeTest.spawnSync(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode === 0) {
    return
  }

  throw new Error(decoder.decode(result.stderr).trim())
}

async function initRepo(repoRoot: string): Promise<void> {
  runOrThrow(['git', 'init', '-b', 'main'], repoRoot)
  runOrThrow(['git', 'config', 'user.name', 'Taskflow Test'], repoRoot)
  runOrThrow(['git', 'config', 'user.email', 'taskflow@example.com'], repoRoot)
  await nodeTest.write(join(repoRoot, 'README.md'), '# test\n')
  runOrThrow(['git', 'add', 'README.md'], repoRoot)
  runOrThrow(['git', 'commit', '-m', 'init'], repoRoot)
}

async function installFakeTmux(binDir: string): Promise<void> {
  const tmuxPath = join(binDir, 'tmux')
  await nodeTest.write(
    tmuxPath,
    [
      '#!/usr/bin/env bash',
      'command="$1"',
      'if [ "$command" = "kill-window" ] || [ "$command" = "list-windows" ]; then',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  )
  await chmod(tmuxPath, 0o755)
}

describe('portta flow', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('accepts the daemon port before the command', async () => {
    const { action } = await parseFlow(['--port', '5112', 'list'])
    expect(action?.globals).toEqual({ port: 5112 })
    expect(action?.options).toEqual({})
  })

  it('rejects a non-numeric port', async () => {
    const result = await parseFlow(['--port', 'abc', 'list'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("option '--port <n>' argument 'abc' is invalid")
  })

  it('routes environment arguments without consuming them', async () => {
    const { action } = await parseFlow(['environment', 'feature/x', 'exec', '--', 'npm', 'test'])
    expect(action?.path).toEqual(['environment'])
    expect(action?.args).toEqual(['feature/x', 'exec', ['npm', 'test']])
  })

  it('parses the canonical run command without consuming workspace flags', async () => {
    const { action } = await parseFlow(['run', 'workflow', 'review', '--workspace', 'current'])
    expect(action?.path).toEqual(['run', 'workflow'])
    expect(action?.args).toEqual(['review'])
    expect(action?.options).toEqual({ workspace: 'current' })
  })

  it('passes workflow engine arguments through untouched', async () => {
    const { action } = await parseFlow(['workflows', 'run', 'code-review', '--args', '{}', '--help', '--', 'x'])
    expect(action?.path).toEqual(['workflows', 'run'])
    expect(action?.args).toEqual([['code-review', '--args', '{}', '--help', '--', 'x']])
  })

  it('parses worktree and project commands', async () => {
    expect((await parseFlow(['prune'])).action?.path).toEqual(['prune'])
    expect((await parseFlow(['doctor', '--json'])).action?.options).toEqual({ json: true })
    expect((await parseFlow(['archive', 'feature/search'])).action?.args).toEqual(['feature/search'])
    expect((await parseFlow(['refresh', 'feature/search'])).action?.args).toEqual(['feature/search'])
    expect((await parseFlow(['label', 'feature/search', 'Search', 'ranking'])).action?.args).toEqual([
      'feature/search',
      ['Search', 'ranking'],
    ])
  })

  it('runs worktree commands from a project subdirectory', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-cli-'))
    tempDirs.push(repoRoot)

    await initRepo(repoRoot)
    await nodeTest.write(join(repoRoot, '.portta/taskflow.yaml'), 'name: Test\n')

    const nestedDir = join(repoRoot, 'nested', 'dir')
    await mkdir(nestedDir, { recursive: true })

    const home = await mkdtemp(join(tmpdir(), 'taskflow-home-'))
    tempDirs.push(home)

    const result = nodeTest.spawnSync(
      [process.execPath, '--import', tsxLoader, porttaEntry, 'flow', 'open', 'missing-branch'],
      {
        cwd: nestedDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, HOME: home, PORTTA_HOST_STATE_DIR: join(home, 'state') },
      },
    )
    const stderr = decoder.decode(result.stderr).trim()

    expect(result.exitCode).toBe(1)
    expect(stderr).not.toContain('No .portta/taskflow.yaml found in this directory.')
    expect(stderr).toContain('Worktree not found: missing-branch')
  })

  it('removes the current linked worktree when invoked from inside it', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-cli-'))
    tempDirs.push(repoRoot)

    await initRepo(repoRoot)
    await nodeTest.write(
      join(repoRoot, '.portta/taskflow.yaml'),
      ['name: Test', 'workspace:', '  mainBranch: main', '  worktrees:', '    root: __worktrees', ''].join('\n'),
    )

    const worktreesRoot = join(repoRoot, '__worktrees')
    await mkdir(worktreesRoot, { recursive: true })
    const fakeBin = join(repoRoot, '.test-bin')
    await mkdir(fakeBin, { recursive: true })
    await installFakeTmux(fakeBin)

    const worktreePath = join(worktreesRoot, 'feature-self-remove')
    runOrThrow(['git', 'worktree', 'add', '-b', 'feature-self-remove', worktreePath], repoRoot)

    const home = await mkdtemp(join(tmpdir(), 'taskflow-home-'))
    tempDirs.push(home)

    const result = nodeTest.spawnSync(
      [process.execPath, '--import', tsxLoader, porttaEntry, 'flow', 'remove', 'feature-self-remove'],
      {
        cwd: worktreePath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          HOME: home,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PORTTA_HOST_STATE_DIR: join(home, 'state'),
        },
      },
    )
    const stdout = decoder.decode(result.stdout).trim()
    const stderr = decoder.decode(result.stderr).trim()
    const worktreeList = nodeTest.spawnSync(['git', 'worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain('Removed worktree feature-self-remove')
    expect(stderr).toBe('')
    expect(decoder.decode(worktreeList.stdout)).not.toContain(worktreePath)
  })
})
