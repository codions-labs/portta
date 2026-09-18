import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalizeFsPath,
  filterLiveWorktreeEntries,
  listGitWorktrees,
  listLocalGitBranches,
  NodeGitGateway,
  parseGitWorktreePorcelain,
  readGitWorktreeStatus,
  removeGitWorktree,
  resolveWorktreeGitDir,
  resolveWorktreeRoot,
  sameFsPath,
  worktreeEntryPathExists,
} from '../adapters/git.ts'

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function run(args: string[], cwd: string): void {
  const result = nodeTest.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`${args.join(' ')} failed: ${stderr || `exit ${result.exitCode}`}`)
  }
}

function read(args: string[], cwd: string): string {
  const result = nodeTest.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`${args.join(' ')} failed: ${stderr || `exit ${result.exitCode}`}`)
  }

  return new TextDecoder().decode(result.stdout).trim()
}

describe('parseGitWorktreePorcelain', () => {
  it('parses branch and detached entries', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo__worktrees/feature',
      'HEAD def456',
      'detached',
      '',
    ].join('\n')

    expect(parseGitWorktreePorcelain(output)).toEqual([
      {
        path: '/repo',
        head: 'abc123',
        branch: 'main',
        detached: false,
        bare: false,
      },
      {
        path: '/repo__worktrees/feature',
        head: 'def456',
        branch: null,
        detached: true,
        bare: false,
      },
    ])
  })
})

describe('canonicalizeFsPath / sameFsPath', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('treats a directory and a symlink to it as the same location', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-canon-'))
    dirs.push(dir)
    const link = join(dirname(dir), `${dir.split('/').pop()}-link`)
    await symlink(dir, link)
    dirs.push(link)
    expect(sameFsPath(dir, link)).toBe(true)
    expect(dir === link).toBe(false)
  })

  it('matches git porcelain paths under os.tmpdir even when string equality fails', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-git-canon-'))
    dirs.push(repoRoot)
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    const listed = listGitWorktrees(repoRoot).map((entry) => entry.path)
    expect(listed.some((path) => sameFsPath(path, repoRoot))).toBe(true)
    // On macOS tmpdir is /var -> /private/var; git prints the realpath.
    expect(
      listed.some((path) => path === repoRoot) || canonicalizeFsPath(listed[0] ?? '') === canonicalizeFsPath(repoRoot),
    ).toBe(true)
  })

  it('canonicalizes a deleted leaf via its existing ancestor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-canon-missing-'))
    dirs.push(dir)
    const missing = join(dir, 'gone', 'leaf')
    expect(sameFsPath(missing, join(dir, 'gone', 'leaf'))).toBe(true)
    expect(canonicalizeFsPath(missing)).toBe(join(canonicalizeFsPath(dir), 'gone', 'leaf'))
  })
})

describe('git worktree path resolution', () => {
  let repoRoot = ''

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true })
      repoRoot = ''
    }
  })

  it('resolves the worktree root and worktree git admin dir for linked worktrees', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-git-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)

    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    const worktreesRoot = join(repoRoot, '__worktrees')
    await mkdir(worktreesRoot, { recursive: true })
    const worktreePath = join(worktreesRoot, 'feature')
    run(['git', 'worktree', 'add', '-b', 'feature', worktreePath], repoRoot)

    expect(sameFsPath(resolveWorktreeRoot(worktreePath), worktreePath)).toBe(true)

    const gitDir = normalizePath(resolveWorktreeGitDir(worktreePath))
    expect(gitDir).toContain('/.git/worktrees/feature')
  })
})

describe('NodeGitGateway', () => {
  let repoRoot = ''

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true })
      repoRoot = ''
    }
  })

  it('creates and removes worktrees', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-gitgw-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    const gateway = new NodeGitGateway()
    const worktreePath = join(repoRoot, '__worktrees', 'feature-a')
    await mkdir(join(repoRoot, '__worktrees'), { recursive: true })

    gateway.createWorktree({
      repoRoot,
      worktreePath,
      branch: 'feature-a',
      mode: 'new',
      baseBranch: 'main',
    })

    expect(nodeTest.file(join(worktreePath, 'README.md')).size).toBeGreaterThan(0)
    expect(gateway.listWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(true)

    gateway.removeWorktree({
      repoRoot,
      worktreePath,
    })

    expect(gateway.listWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(false)
  })

  it('creates a worktree for an existing branch', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-gitgw-existing-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)
    run(['git', 'checkout', '-b', 'feature-existing'], repoRoot)
    run(['git', 'checkout', 'main'], repoRoot)

    const gateway = new NodeGitGateway()
    const worktreePath = join(repoRoot, '__worktrees', 'feature-existing')
    await mkdir(join(repoRoot, '__worktrees'), { recursive: true })

    gateway.createWorktree({
      repoRoot,
      worktreePath,
      branch: 'feature-existing',
      mode: 'existing',
    })

    expect(gateway.listWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(true)
    expect(read(['git', 'branch', '--show-current'], worktreePath)).toBe('feature-existing')
  })

  it('lists local branches', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-gitgw-branches-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)
    run(['git', 'checkout', '-b', 'feature-a'], repoRoot)
    run(['git', 'checkout', '-b', 'feature-b', 'main'], repoRoot)
    run(['git', 'checkout', 'main'], repoRoot)

    expect(listLocalGitBranches(repoRoot)).toEqual(['feature-a', 'feature-b', 'main'])
  })

  it('merges a source branch into a target branch', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-mergegw-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    run(['git', 'checkout', '-b', 'feature-b'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\nfeature change\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'feature'], repoRoot)
    run(['git', 'checkout', 'main'], repoRoot)

    const gateway = new NodeGitGateway()
    gateway.mergeBranch({
      repoRoot,
      sourceBranch: 'feature-b',
      targetBranch: 'main',
    })

    const log = nodeTest.spawnSync(['git', 'log', '--oneline', '--max-count', '1'], {
      cwd: repoRoot,
      stdout: 'pipe',
    })
    const text = new TextDecoder().decode(log.stdout)
    expect(text).toContain("Merge branch 'feature-b'")
  })

  it('restores the original branch after a successful merge into another target branch', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-merge-restore-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    run(['git', 'checkout', '-b', 'feature-restore'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\nfeature change\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'feature'], repoRoot)
    run(['git', 'checkout', '-b', 'dev', 'main'], repoRoot)

    const gateway = new NodeGitGateway()
    gateway.mergeBranch({
      repoRoot,
      sourceBranch: 'feature-restore',
      targetBranch: 'main',
    })

    expect(gateway.currentBranch(repoRoot)).toBe('dev')
    expect(
      read(['git', 'log', '--oneline', '--max-count', '1', 'main'], repoRoot).includes(
        "Merge branch 'feature-restore'",
      ),
    ).toBe(true)
  })

  it('aborts the merge and restores the original branch when merge conflicts', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-merge-conflict-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), 'base\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    run(['git', 'checkout', '-b', 'feature-conflict'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), 'feature branch change\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'feature change'], repoRoot)

    run(['git', 'checkout', 'main'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), 'main branch change\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'main change'], repoRoot)

    run(['git', 'checkout', '-b', 'dev'], repoRoot)

    const gateway = new NodeGitGateway()
    expect(() => {
      gateway.mergeBranch({
        repoRoot,
        sourceBranch: 'feature-conflict',
        targetBranch: 'main',
      })
    }).toThrow()

    expect(gateway.currentBranch(repoRoot)).toBe('dev')
    const mergeHead = nodeTest.spawnSync(['git', 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(mergeHead.exitCode).not.toBe(0)
    expect(read(['git', 'show', 'main:README.md'], repoRoot)).toBe('main branch change')
  })

  it('reads dirty state, ahead count, and current commit', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-statusgw-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)
    run(['git', 'checkout', '-b', 'feature-status'], repoRoot)
    run(['git', 'branch', '--set-upstream-to=main', 'feature-status'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\nfeature status\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'feature work'], repoRoot)

    const cleanStatus = readGitWorktreeStatus(repoRoot)
    expect(cleanStatus.dirty).toBe(false)
    expect(cleanStatus.aheadCount).toBe(1)
    expect(cleanStatus.currentCommit).not.toBeNull()

    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\nfeature status\ndirty\n')
    const dirtyStatus = new NodeGitGateway().readWorktreeStatus(repoRoot)
    expect(dirtyStatus.dirty).toBe(true)
    expect(dirtyStatus.aheadCount).toBe(1)
    expect(dirtyStatus.currentCommit).toBe(cleanStatus.currentCommit)
  })

  it('reads short git status output for added and deleted files', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-status-lines-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    await nodeTest.write(join(repoRoot, 'removed.txt'), 'remove me\n')
    run(['git', 'add', 'README.md', 'removed.txt'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    await nodeTest.write(join(repoRoot, 'added.txt'), 'add me\n')
    run(['git', 'add', 'added.txt'], repoRoot)
    run(['git', 'rm', 'removed.txt'], repoRoot)

    const status = new NodeGitGateway().readStatus(repoRoot)
    expect(status).toContain('A  added.txt')
    expect(status).toContain('D  removed.txt')
  })
})

describe('stale worktree resilience', () => {
  let repoRoot = ''

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true })
      repoRoot = ''
    }
  })

  it('does not throw posix_spawn ENOENT for tryRunGit-backed callers when cwd is missing', () => {
    // Regression for the crash: nodeTest.spawnSync throws synchronously when cwd is gone.
    // tryRunGit-backed callers (readDiff, listUnpushedCommits, fetchBranch, ...) must
    // surface this as a normal failure, not propagate the throw.
    const gateway = new NodeGitGateway()
    expect(() => gateway.readDiff('/tmp/taskflow-missing-xyz-12345-does-not-exist')).not.toThrow()
    expect(gateway.readDiff('/tmp/taskflow-missing-xyz-12345-does-not-exist')).toBe('')
    expect(() => gateway.listUnpushedCommits('/tmp/taskflow-missing-xyz-12345-does-not-exist')).not.toThrow()
    expect(gateway.listUnpushedCommits('/tmp/taskflow-missing-xyz-12345-does-not-exist')).toEqual([])
  })

  it('throws a controlled error when runGit is invoked against a missing cwd', () => {
    // runGit-backed callers re-raise with a readable message that names the cwd —
    // not a bare posix_spawn stack trace.
    expect(() => listLocalGitBranches('/tmp/taskflow-missing-xyz-12345-does-not-exist')).toThrow(
      /cwd=\/tmp\/taskflow-missing-xyz-12345-does-not-exist/,
    )
  })

  it('worktreeEntryPathExists rejects missing paths', () => {
    expect(
      worktreeEntryPathExists({
        path: '/tmp/taskflow-missing-xyz-12345-does-not-exist',
        head: null,
        branch: null,
        detached: false,
        bare: false,
      }),
    ).toBe(false)
  })

  it('filterLiveWorktreeEntries drops stale entries and keeps live ones', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-filter-live-'))
    expect(
      filterLiveWorktreeEntries([
        { path: repoRoot, head: 'abc', branch: 'main', detached: false, bare: false },
        {
          path: '/tmp/taskflow-missing-xyz-12345-does-not-exist',
          head: 'def',
          branch: 'stale',
          detached: false,
          bare: false,
        },
      ]),
    ).toEqual([{ path: repoRoot, head: 'abc', branch: 'main', detached: false, bare: false }])
  })

  it('NodeGitGateway.listLiveWorktrees omits registrations whose directory was deleted', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-stale-wt-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)

    const worktreePath = join(repoRoot, '__worktrees', 'stale')
    await mkdir(join(repoRoot, '__worktrees'), { recursive: true })
    run(['git', 'worktree', 'add', '-b', 'stale', worktreePath], repoRoot)

    await rm(worktreePath, { recursive: true, force: true })

    // Raw list keeps the dangling registration (semantics preserved for removeGitWorktree).
    expect(listGitWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(true)

    // Live list filters it out.
    const gateway = new NodeGitGateway()
    expect(gateway.listLiveWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(false)
    expect(gateway.listLiveWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, repoRoot))).toBe(true)
  })
})

describe('removeGitWorktree', () => {
  it('cleans up the leftover directory when git already unregistered the worktree', () => {
    const removedPaths: string[] = []

    removeGitWorktree(
      {
        repoRoot: '/repo',
        worktreePath: '/repo/__worktrees/feature-a',
        force: true,
      },
      {
        tryRunGit: () => ({
          ok: false,
          stderr: "error: failed to delete '/repo/__worktrees/feature-a': Directory not empty",
        }),
        listWorktrees: () => [
          {
            path: '/repo',
            head: 'abc123',
            branch: 'main',
            detached: false,
            bare: false,
          },
        ],
        removeDirectory: (path) => {
          removedPaths.push(path)
        },
      },
    )

    expect(removedPaths).toEqual(['/repo/__worktrees/feature-a'])
  })

  it('surfaces the git error when the worktree is still registered', () => {
    expect(() => {
      removeGitWorktree(
        {
          repoRoot: '/repo',
          worktreePath: '/repo/__worktrees/feature-a',
          force: true,
        },
        {
          tryRunGit: () => ({
            ok: false,
            stderr: "error: failed to delete '/repo/__worktrees/feature-a': Directory not empty",
          }),
          listWorktrees: () => [
            {
              path: '/repo',
              head: 'abc123',
              branch: 'main',
              detached: false,
              bare: false,
            },
            {
              path: '/repo/__worktrees/feature-a',
              head: 'def456',
              branch: 'feature-a',
              detached: false,
              bare: false,
            },
          ],
        },
      )
    }).toThrow('git worktree remove --force /repo/__worktrees/feature-a failed')
  })
})
