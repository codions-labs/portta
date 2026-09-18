// The Development Context presenter, on its own: what it says about worktrees,
// the base ref and what is wrong, given facts the route gathered.

import type { Environment, Project, RepositoryGit } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import {
  buildContext,
  type ContextInput,
  contextDiagnostics,
  contextWorktrees,
  environmentNameOf,
} from '../src/services/context-view.ts'

const NOW = 1_800_000_000_000

function environment(name: string, overrides: Partial<Environment> = {}): Environment {
  return {
    name,
    integrated: true,
    workingDir: null,
    operable: { ok: true, reason: null, workingDir: null, configFiles: [] },
    startable: { ok: true, reason: null, via: 'iteration' },
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    services: [],
    serviceCount: 2,
    runningCount: 2,
    healthyCount: 2,
    unhealthyCount: 0,
    networks: [],
    urls: [],
    scopes: ['local'],
    startedAt: 1,
    uptimeSeconds: 10,
    ...overrides,
  } as Environment
}

function scan(overrides: Partial<RepositoryGit> = {}): RepositoryGit {
  return {
    key: 'abcdef012345',
    collected: true,
    collectedAt: 1_800_000_000,
    ageSeconds: 30,
    stale: false,
    staleAfterSeconds: 600,
    path: '/srv/projects/shop',
    name: 'shop',
    git: {
      branch: 'main',
      detached: false,
      head: { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'Add totals', author: 'Ada', date: 100 },
      staged: 0,
      unstaged: 0,
      untracked: 0,
      unmerged: 0,
      dirty: false,
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      remote: null,
    },
    remote: null,
    links: { commit: null, branch: null, compare: null, tree: null },
    commits: [],
    instructions: [
      {
        path: 'AGENTS.md',
        audience: 'any',
        sizeBytes: 10,
        modifiedAt: 1,
        sha256: 'x',
        dirty: false,
        content: '# rules',
        truncated: false,
      },
    ],
    specifications: [
      {
        path: 'docs/adr/0001-record.md',
        provider: 'adr',
        kind: 'decision',
        title: '0001. Record',
        sizeBytes: 40,
        modifiedAt: 1,
        sha256: 'ef',
        dirty: false,
      },
    ],
    environments: ['shop'],
    forge: null,
    reason: null,
    refreshCommand: 'portta repos scan',
    ...overrides,
  } as unknown as RepositoryGit
}

const repository = {
  id: '7',
  projectId: '1',
  name: 'api',
  role: 'api',
  provider: 'github',
  localPath: '/srv/projects/shop',
  relativePath: null,
  remoteUrl: null,
  position: 0,
  scanKey: 'abcdef012345',
  scanPath: '/srv/projects/shop',
  git: {
    branch: 'main',
    detached: false,
    head: null,
    dirty: false,
    changed: 0,
    ahead: 1,
    behind: 0,
    base: 'origin/main',
    collectedAt: 1_800_000_000,
    stale: false,
  },
  github: null,
  environments: ['shop'],
  instructionCount: 1,
}

const project = {
  id: '1',
  slug: 'shop',
  name: 'Shop',
  description: 'The shop',
  archived: false,
  relativePath: 'shop',
  resolvedPath: '/srv/projects/shop',
  location: 'managed',
  repositories: [repository],
  environments: [
    {
      environment: 'shop',
      source: 'path',
      running: true,
      serviceCount: 2,
      runningCount: 2,
      unhealthyCount: 0,
      urls: [],
    },
  ],
} as unknown as Project

function input(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    now: NOW,
    actor: 'claude',
    permissions: ['project:read'],
    project,
    issue: null,
    scans: new Map([['abcdef012345', scan()]]),
    environments: [environment('shop')],
    services: new Map(),
    worktrees: [],
    taskflow: { enabled: false, reachable: false },
    ...overrides,
  }
}

describe('the Development Context contract', () => {
  it('names its schema and version, and carries the base ref beside ahead and behind', () => {
    const context = buildContext(input())
    expect(context.schema).toBe('development-context')
    expect(context.version).toBe(1)
    expect(context.repositories[0]?.git?.base).toBe('origin/main')
    expect(context.repositories[0]?.specifications).toEqual([
      expect.objectContaining({ path: 'docs/adr/0001-record.md', kind: 'decision' }),
    ])
    expect(context.diagnostics).toEqual([])
  })
})

describe('worktrees in the context', () => {
  const worktrees = [
    {
      directory: '/srv/projects/shop/',
      path: '/srv/worktrees/shop/issue-12',
      branch: 'issue-12-totals',
      base: 'main',
      environmentId: 'env_0123456789abcdef',
    },
    {
      directory: '/srv/projects/shop',
      path: '/srv/worktrees/shop/issue-13',
      branch: 'issue-13',
      base: null,
      environmentId: null,
    },
    { directory: '/srv/projects/other', path: '/srv/worktrees/other/x', branch: 'x', base: null, environmentId: null },
  ]

  it('lists the worktrees of the repository that serves their directory, and names the adopted Environment that runs one', () => {
    const context = buildContext(
      input({
        worktrees,
        environments: [environment('shop'), environment(environmentNameOf('env_0123456789abcdef'))],
        taskflow: { enabled: true, reachable: true },
      }),
    )
    expect(context.repositories[0]?.worktrees).toEqual([
      {
        path: '/srv/worktrees/shop/issue-12',
        branch: 'issue-12-totals',
        base: 'main',
        environmentId: 'env_0123456789abcdef',
        environment: 'taskflow-0123456789abcdef',
      },
      { path: '/srv/worktrees/shop/issue-13', branch: 'issue-13', base: null, environmentId: null, environment: null },
    ])
  })

  it('keeps the Taskflow environment id but names no Environment the Project did not adopt', () => {
    expect(contextWorktrees(input({ worktrees }), '/srv/projects/shop')[0]).toMatchObject({
      environmentId: 'env_0123456789abcdef',
      environment: null,
    })
  })

  it('has none for a repository without a path', () => {
    expect(contextWorktrees(input({ worktrees }), null)).toEqual([])
  })
})

describe('diagnostics in the context', () => {
  it('says a repository has no path, and looks no further into it', () => {
    const pathless = {
      ...project,
      repositories: [{ ...repository, localPath: null, scanPath: null, scanKey: null, git: null }],
    } as unknown as Project
    const diagnostics = contextDiagnostics(input({ project: pathless, scans: new Map() }))
    expect(diagnostics.map((d) => d.id)).toEqual(['repository-path-unknown:api'])
    expect(diagnostics[0]).toMatchObject({ status: 'warn', category: 'development' })
  })

  it('says a repository is not scanned yet, with the command that scans it', () => {
    const diagnostics = contextDiagnostics(input({ scans: new Map() }))
    expect(diagnostics).toMatchObject([{ id: 'scan-missing:api', status: 'info', fix: 'portta repos scan' }])
  })

  it('says a scan is stale, and how old', () => {
    const diagnostics = contextDiagnostics(
      input({ scans: new Map([['abcdef012345', scan({ stale: true, ageSeconds: 900 })]]) }),
    )
    expect(diagnostics).toMatchObject([
      { id: 'scan-stale:api', status: 'warn', fix: 'portta repos scan', params: { ageSeconds: 900 } },
    ])
  })

  it('says an adopted Environment is stopped, with the command that starts it', () => {
    const diagnostics = contextDiagnostics(input({ environments: [environment('shop', { runningCount: 0 })] }))
    expect(diagnostics).toMatchObject([
      { id: 'environment-stopped:shop', status: 'warn', fix: 'portta envs start shop' },
    ])
  })

  it('says the worktrees are unknown when Taskflow is on and the daemon did not answer, and nothing when it is off', () => {
    expect(contextDiagnostics(input({ taskflow: { enabled: true, reachable: false } }))).toMatchObject([
      { id: 'taskflow-unreachable', status: 'warn', fix: 'portta flow doctor' },
    ])
    expect(contextDiagnostics(input({ taskflow: { enabled: false, reachable: false } }))).toEqual([])
    expect(contextDiagnostics(input({ taskflow: { enabled: true, reachable: true } }))).toEqual([])
  })
})
