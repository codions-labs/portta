import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorktreeMeta } from 'portta-core/taskflow'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildRuntimeEnvMap,
  getWorktreeStoragePaths,
  loadDotenvLocal,
  parseDotenv,
  readWorktreeMeta,
  readWorktreePrs,
  renderEnvFile,
  writeWorktreeMeta,
  writeWorktreePrs,
} from '../adapters/fs.ts'
import {
  type GitGateway,
  NodeGitGateway,
  sameFsPath,
  type TryGitCommandResult,
  type UnpushedCommit,
} from '../adapters/git.ts'
import type { SessionGateway, SessionWindowSummary } from '../adapters/session-gateway.ts'
import { createManagedWorktree, initializeManagedWorktree } from '../services/worktree-service.ts'

function run(args: string[], cwd: string): string {
  const result = nodeTest.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`${args.join(' ')} failed: ${stderr || `exit ${result.exitCode}`}`)
  }

  return new TextDecoder().decode(result.stdout).trim()
}

class FakeGitGateway implements GitGateway {
  private readonly gitDir: string
  private readonly calls: string[]
  constructor(gitDir: string, calls: string[]) {
    this.gitDir = gitDir
    this.calls = calls
  }

  resolveRepoRoot(dir: string): string | null {
    this.calls.push(`resolveRepoRoot:${dir}`)
    return dir
  }

  resolveWorktreeRoot(cwd: string): string {
    this.calls.push(`resolveWorktreeRoot:${cwd}`)
    return cwd
  }

  resolveWorktreeGitDir(cwd: string): string {
    this.calls.push(`resolveWorktreeGitDir:${cwd}`)
    return this.gitDir
  }

  listWorktrees() {
    return []
  }

  listLiveWorktrees() {
    return []
  }

  listLocalBranches(): string[] {
    return []
  }

  listRemoteBranches(): string[] {
    return []
  }

  readWorktreeStatus() {
    return {
      dirty: false,
      aheadCount: 0,
      currentCommit: null,
    }
  }

  countUnsavedCommits(): number {
    return 0
  }

  readStatus(): string {
    return ''
  }

  createWorktree(opts: {
    repoRoot: string
    worktreePath: string
    branch: string
    mode: 'new' | 'existing'
    baseBranch?: string
    startPoint?: string
  }): void {
    this.calls.push(
      `createWorktree:${opts.repoRoot}:${opts.worktreePath}:${opts.branch}:${opts.mode}:${opts.baseBranch ?? ''}:${opts.startPoint ?? ''}`,
    )
  }

  removeWorktree(): void {
    this.calls.push('removeWorktree')
  }

  deleteBranch(): void {
    this.calls.push('deleteBranch')
  }

  mergeBranch(): void {
    this.calls.push('mergeBranch')
  }

  currentBranch(): string {
    return 'main'
  }

  resolveCommit(): string {
    return 'abc123'
  }

  createAndSwitchBranch(): void {}

  readDiff(): string {
    return ''
  }

  listUnpushedCommits(): UnpushedCommit[] {
    return []
  }

  fetchBranch(_repoRoot: string, _remote: string, _branch: string): TryGitCommandResult {
    return { ok: true, stdout: '' }
  }

  fastForwardMerge(_repoRoot: string, _ref: string): TryGitCommandResult {
    return { ok: true, stdout: '' }
  }

  hardReset(_repoRoot: string, _ref: string): TryGitCommandResult {
    return { ok: true, stdout: '' }
  }
}

class FakeSessionGateway implements SessionGateway {
  createWindowError: Error | null = null

  private readonly calls: string[]
  constructor(calls: string[]) {
    this.calls = calls
  }

  async getPaneId(_target: string): Promise<string> {
    return '%0'
  }

  async createParkedPane(_opts: {
    sessionName: string
    parkingWindow: string
    cwd: string
    command: string
  }): Promise<string> {
    return '%99'
  }

  async swapPanes(_source: string, _destination: string): Promise<void> {}

  async killPane(_target: string): Promise<void> {}

  async ensureServer(): Promise<void> {
    this.calls.push('ensureServer')
  }

  async ensureSession(sessionName: string, cwd: string): Promise<void> {
    this.calls.push(`ensureSession:${sessionName}:${cwd}`)
  }

  async hasWindow(sessionName: string, windowName: string): Promise<boolean> {
    this.calls.push(`hasWindow:${sessionName}:${windowName}`)
    return false
  }

  async killWindow(sessionName: string, windowName: string): Promise<void> {
    this.calls.push(`killWindow:${sessionName}:${windowName}`)
  }

  async createWindow(opts: { sessionName: string; windowName: string; cwd: string; command?: string }): Promise<void> {
    this.calls.push(`createWindow:${opts.sessionName}:${opts.windowName}:${opts.cwd}:${opts.command ?? ''}`)
    if (this.createWindowError) throw this.createWindowError
  }

  async splitWindow(opts: {
    target: string
    split: 'right' | 'bottom'
    sizePct?: number
    cwd: string
    command?: string
  }): Promise<void> {
    this.calls.push(`splitWindow:${opts.target}:${opts.split}:${opts.sizePct ?? ''}:${opts.cwd}:${opts.command ?? ''}`)
  }

  async runCommand(target: string, command: string): Promise<void> {
    this.calls.push(`runCommand:${target}:${command}`)
  }

  async selectPane(target: string): Promise<void> {
    this.calls.push(`selectPane:${target}`)
  }

  async focusWindow(_sessionName: string, _windowName: string): Promise<void> {}

  async listWindows(): Promise<SessionWindowSummary[]> {
    return []
  }
}

function makeMeta(): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: 'wt_test',
    branch: 'feature/search-panel',
    baseBranch: 'main',
    createdAt: '2026-03-06T00:00:00.000Z',
    profile: 'default',
    agent: 'claude',
    runtime: 'host',
    startupEnvValues: {
      NODE_ENV: 'development',
    },
    allocatedPorts: {
      PORT: 5111,
      FRONTEND_PORT: 3010,
    },
  }
}

describe('renderEnvFile', () => {
  it('sorts keys and quotes unsafe values', () => {
    const rendered = renderEnvFile({
      Z_LAST: 'two words',
      A_FIRST: 'simple',
      EMPTY: '',
    })

    expect(rendered).toBe(['A_FIRST=simple', "EMPTY=''", "Z_LAST='two words'", ''].join('\n'))
  })
})

describe('parseDotenv', () => {
  it('parses key=value pairs, ignoring comments and blank lines', () => {
    const content = [
      '# database config',
      'DB_HOST=localhost',
      'DB_PORT=5432',
      '',
      '  # another comment',
      "SECRET_KEY='my secret'",
      'API_URL="https://example.com"',
    ].join('\n')

    expect(parseDotenv(content)).toEqual({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      SECRET_KEY: 'my secret',
      API_URL: 'https://example.com',
    })
  })

  it('handles values containing equals signs', () => {
    expect(parseDotenv('CONN=host=localhost;port=5432')).toEqual({
      CONN: 'host=localhost;port=5432',
    })
  })

  it('returns empty object for empty content', () => {
    expect(parseDotenv('')).toEqual({})
    expect(parseDotenv('# just a comment')).toEqual({})
  })

  it('handles export prefix', () => {
    expect(parseDotenv("export FOO=bar\nexport BAZ='hello world'")).toEqual({
      FOO: 'bar',
      BAZ: 'hello world',
    })
  })

  it('trims trailing whitespace on unquoted values', () => {
    expect(parseDotenv('KEY=value   ')).toEqual({ KEY: 'value' })
  })

  it('preserves a lone quote character as-is', () => {
    expect(parseDotenv('KEY="')).toEqual({ KEY: '"' })
    expect(parseDotenv("KEY='")).toEqual({ KEY: "'" })
  })
})

describe('loadDotenvLocal', () => {
  it('returns empty object when .env.local does not exist', async () => {
    const env = await loadDotenvLocal('/nonexistent/path')
    expect(env).toEqual({})
  })

  it('loads and parses .env.local from worktree path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-dotenv-'))
    try {
      await nodeTest.write(join(dir, '.env.local'), 'FOO=bar\nBAZ=qux\n')
      const env = await loadDotenvLocal(dir)
      expect(env).toEqual({ FOO: 'bar', BAZ: 'qux' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('worktree env maps', () => {
  it('builds runtime env with metadata-derived Taskflow fields', () => {
    const env = buildRuntimeEnvMap(makeMeta(), {
      PORTTA_FLOW_BRANCH: 'override-me',
      PORTTA_FLOW_WORKTREE_PATH: '/tmp/worktree',
    })

    expect(env.FRONTEND_PORT).toBe('3010')
    expect(env.PORT).toBe('5111')
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORTTA_FLOW_WORKTREE_PATH).toBe('/tmp/worktree')
    expect(env.PORTTA_FLOW_BRANCH).toBe('feature/search-panel')
    expect(env.PORTTA_FLOW_PROFILE).toBe('default')
  })

  it('includes dotenv values at lowest priority', () => {
    const dotenv = {
      NODE_ENV: 'production',
      CUSTOM_VAR: 'from-dotenv',
      FRONTEND_PORT: '9999',
    }
    const env = buildRuntimeEnvMap(
      makeMeta(),
      {
        PORTTA_FLOW_WORKTREE_PATH: '/tmp/worktree',
      },
      dotenv,
    )

    expect(env.CUSTOM_VAR).toBe('from-dotenv')
    expect(env.NODE_ENV).toBe('development')
    expect(env.FRONTEND_PORT).toBe('3010')
  })
})

describe('initializeManagedWorktree', () => {
  let repoRoot = ''
  let gitDir = ''
  let worktreePath = ''

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true })
      repoRoot = ''
    }
    if (gitDir) {
      await rm(gitDir, { recursive: true, force: true })
      gitDir = ''
    }
    if (worktreePath) {
      await rm(worktreePath, { recursive: true, force: true })
      worktreePath = ''
    }
  })

  it('writes metadata and env files into the worktree git admin dir', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-gitdir-'))
    worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-worktree-'))

    const result = await initializeManagedWorktree({
      gitDir,
      branch: 'feature/search-panel',
      baseBranch: 'main',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
      startupEnvValues: { NODE_ENV: 'development' },
      allocatedPorts: { FRONTEND_PORT: 3010, PORT: 5111 },
      runtimeEnvExtras: { PORTTA_FLOW_WORKTREE_PATH: worktreePath },
      controlUrl: 'http://127.0.0.1:5111',
      controlToken: 'secret-token',
      worktreeId: 'wt_test',
      now: () => new Date('2026-03-06T00:00:00.000Z'),
    })

    const paths = getWorktreeStoragePaths(gitDir)
    const meta = await readWorktreeMeta(gitDir)
    const runtimeEnvText = await nodeTest.file(paths.runtimeEnvPath).text()
    const controlEnvText = await nodeTest.file(paths.controlEnvPath).text()

    expect(result.paths).toEqual(paths)
    expect(meta).not.toBeNull()
    expect(meta?.worktreeId).toBe('wt_test')
    expect(meta?.baseBranch).toBe('main')
    expect(meta?.allocatedPorts.FRONTEND_PORT).toBe(3010)

    expect(runtimeEnvText).toContain('FRONTEND_PORT=3010')
    expect(runtimeEnvText).toContain('PORTTA_FLOW_BRANCH=feature/search-panel')
    expect(runtimeEnvText).toContain(`PORTTA_FLOW_WORKTREE_PATH=${worktreePath}`)

    expect(controlEnvText).toContain('PORTTA_FLOW_CONTROL_TOKEN=secret-token')
    expect(controlEnvText).toContain('PORTTA_FLOW_CONTROL_URL=http://127.0.0.1:5111')
    expect(paths.prsPath).toBe(`${paths.taskflowDir}/prs.json`)
  })

  it('gives a meta without tabs a single root tab bound to its conversation', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-meta-normalize-'))

    const paths = getWorktreeStoragePaths(gitDir)
    await mkdir(paths.taskflowDir, { recursive: true })
    await nodeTest.write(
      paths.metaPath,
      JSON.stringify(
        {
          ...makeMeta(),
          conversation: {
            provider: 'codexAppServer',
            conversationId: 'thread-1',
            threadId: 'thread-1',
            cwd: '/repo/__worktrees/feature-search',
            lastSeenAt: '2026-04-14T10:00:00.000Z',
          },
        },
        null,
        2,
      ),
    )

    expect(await readWorktreeMeta(gitDir)).toEqual({
      ...makeMeta(),
      interfaceMode: 'terminal',
      conversation: {
        provider: 'codexAppServer',
        conversationId: 'thread-1',
        threadId: 'thread-1',
        cwd: '/repo/__worktrees/feature-search',
        lastSeenAt: '2026-04-14T10:00:00.000Z',
      },
      tabs: [
        {
          tabId: 'root',
          kind: 'root',
          label: 'Root',
          seq: null,
          sessionId: 'thread-1',
          createdAt: '2026-03-06T00:00:00.000Z',
        },
      ],
      activeTabId: 'root',
      forkCounter: 0,
    })
  })

  it('round-trips an issueRef on worktree metadata', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-meta-issue-'))
    await writeWorktreeMeta(gitDir, { ...makeMeta(), issueRef: 'github:acme/api#113' })
    expect((await readWorktreeMeta(gitDir))?.issueRef).toBe('github:acme/api#113')
  })

  it('normalizes blank labels out of worktree metadata', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-meta-label-'))

    await writeWorktreeMeta(gitDir, {
      ...makeMeta(),
      label: '   ',
    })

    expect((await readWorktreeMeta(gitDir))?.label).toBeUndefined()
  })

  it('round-trips PR storage through the worktree taskflow dir', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-prs-gitdir-'))

    await writeWorktreePrs(gitDir, [
      {
        repo: 'org/repo',
        number: 77,
        state: 'open',
        isDraft: false,
        url: 'https://github.com/org/repo/pull/77',
        updatedAt: '2026-03-06T00:00:00.000Z',
        ciStatus: 'pending',
        ciChecks: [
          {
            name: 'build',
            status: 'pending',
            url: 'https://github.com/org/repo/actions/runs/123',
            runId: 123,
          },
        ],
        comments: [],
      },
    ])

    expect(await readWorktreePrs(gitDir)).toEqual([
      {
        repo: 'org/repo',
        number: 77,
        state: 'open',
        isDraft: false,
        url: 'https://github.com/org/repo/pull/77',
        updatedAt: '2026-03-06T00:00:00.000Z',
        ciStatus: 'pending',
        ciChecks: [
          {
            name: 'build',
            status: 'pending',
            url: 'https://github.com/org/repo/actions/runs/123',
            runId: 123,
          },
        ],
        comments: [],
      },
    ])
  })

  it('defaults isDraft to false for a PR entry that omits it', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-prs-nodraft-'))
    const { taskflowDir, prsPath } = getWorktreeStoragePaths(gitDir)
    await mkdir(taskflowDir, { recursive: true })
    await nodeTest.write(
      prsPath,
      JSON.stringify([
        {
          repo: 'org/repo',
          number: 77,
          state: 'open',
          url: 'https://github.com/org/repo/pull/77',
          updatedAt: '2026-03-06T00:00:00.000Z',
          ciStatus: 'pending',
          ciChecks: [],
          comments: [],
        },
      ]),
    )

    const entries = await readWorktreePrs(gitDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.isDraft).toBe(false)
  })

  it('can create a managed worktree and realize a tmux layout through gateways', async () => {
    gitDir = await mkdtemp(join(tmpdir(), 'taskflow-create-gitdir-'))
    worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-create-worktree-'))
    await rm(worktreePath, { recursive: true, force: true })
    await mkdir(worktreePath, { recursive: true })

    const calls: string[] = []
    const git = new FakeGitGateway(gitDir, calls)
    const tmux = new FakeSessionGateway(calls)

    await createManagedWorktree(
      {
        repoRoot: '/repo/project',
        worktreePath,
        branch: 'feature/search-panel',
        mode: 'new',
        baseBranch: 'main',
        profile: 'default',
        agent: 'claude',
        runtime: 'host',
        startupEnvValues: { NODE_ENV: 'development' },
        allocatedPorts: { FRONTEND_PORT: 3010 },
        controlUrl: 'http://127.0.0.1:5111',
        controlToken: 'secret-token',
        worktreeId: 'wt_test',
        now: () => new Date('2026-03-06T00:00:00.000Z'),
        sessionLayoutPlan: {
          sessionName: 'tf-project-12345678',
          windowName: 'tf-feature/search-panel',
          focusPaneIndex: 0,
          panes: [
            {
              id: 'agent',
              index: 0,
              kind: 'agent',
              cwd: worktreePath,
              launchCommand: 'agent-cmd',
              startupCommand: 'agent-cmd',
              focus: true,
            },
          ],
        },
      },
      { git, sessions: tmux },
    )

    expect(calls[0]).toBe(`createWorktree:/repo/project:${worktreePath}:feature/search-panel:new:main:`)
    expect(calls).toContain('ensureServer')
    expect(calls.some((call) => call.startsWith('createWindow:tf-project-12345678:tf-feature/search-panel'))).toBe(true)

    const meta = await readWorktreeMeta(gitDir)
    expect(meta?.branch).toBe('feature/search-panel')
    expect(meta?.baseBranch).toBe('main')
  })

  it('rolls back the git worktree and branch when initialization fails after creation', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-create-rollback-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)
    await mkdir(join(repoRoot, '__worktrees'), { recursive: true })

    worktreePath = join(repoRoot, '__worktrees', 'feature-rollback')

    await expect(
      createManagedWorktree(
        {
          repoRoot,
          worktreePath,
          branch: 'feature-rollback',
          mode: 'new',
          baseBranch: 'main',
          profile: 'default',
          agent: 'claude',
          runtime: 'host',
          controlUrl: 'http://127.0.0.1:5111',
        },
        { git: new NodeGitGateway() },
      ),
    ).rejects.toThrow('controlUrl and controlToken must be provided together')

    expect(new NodeGitGateway().listWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(
      false,
    )
    expect(run(['git', 'branch', '--list', 'feature-rollback'], repoRoot)).toBe('')
  })

  it('rolls back the git worktree and branch when tmux layout creation fails', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'taskflow-create-tmux-rollback-'))
    run(['git', 'init', '-b', 'main'], repoRoot)
    run(['git', 'config', 'user.name', 'Test User'], repoRoot)
    run(['git', 'config', 'user.email', 'test@example.com'], repoRoot)
    await nodeTest.write(join(repoRoot, 'README.md'), '# repo\n')
    run(['git', 'add', 'README.md'], repoRoot)
    run(['git', 'commit', '-m', 'init'], repoRoot)
    await mkdir(join(repoRoot, '__worktrees'), { recursive: true })

    worktreePath = join(repoRoot, '__worktrees', 'feature-tmux-rollback')

    const calls: string[] = []
    const tmux = new FakeSessionGateway(calls)
    tmux.createWindowError = new Error('tmux exploded')

    await expect(
      createManagedWorktree(
        {
          repoRoot,
          worktreePath,
          branch: 'feature-tmux-rollback',
          mode: 'new',
          baseBranch: 'main',
          profile: 'default',
          agent: 'claude',
          runtime: 'host',
          worktreeId: 'wt_tmux_rollback',
          sessionLayoutPlan: {
            sessionName: 'tf-project-12345678',
            windowName: 'tf-feature-tmux-rollback',
            focusPaneIndex: 0,
            panes: [
              {
                id: 'agent',
                index: 0,
                kind: 'agent',
                cwd: worktreePath,
                launchCommand: 'agent-cmd',
                startupCommand: 'agent-cmd',
                focus: true,
              },
            ],
          },
        },
        { git: new NodeGitGateway(), sessions: tmux },
      ),
    ).rejects.toThrow('tmux exploded')

    expect(calls).toContain('killWindow:tf-project-12345678:tf-feature-tmux-rollback')
    expect(new NodeGitGateway().listWorktrees(repoRoot).some((entry) => sameFsPath(entry.path, worktreePath))).toBe(
      false,
    )
    expect(run(['git', 'branch', '--list', 'feature-tmux-rollback'], repoRoot)).toBe('')
  })
})
