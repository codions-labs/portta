import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProjectSessionName, buildWorktreeWindowName } from 'portta-host/taskflow/adapters/session-gateway'
import type {
  CreateLifecycleWorktreeInput,
  CreateLifecycleWorktreesInput,
  PruneWorktreesResult,
  RemoveWorktreeOptions,
} from 'portta-host/taskflow/services/lifecycle-service'
import { afterEach, describe, expect, it } from 'vitest'
import { daemonUnreachableHint } from './daemon.ts'
import { parseFlowAction } from './test-support.ts'
import {
  type ParsedAddCommand,
  type ParsedSendCommand,
  runWorktreeCommand,
  type WorktreeRequest,
  worktreeRequestFromCli,
} from './worktree-commands.ts'

/** A worktree command as the CLI parses and validates it. */
async function parse<K extends WorktreeRequest['command']>(
  command: K,
  args: string[],
): Promise<WorktreeRequest & { command: K }> {
  return worktreeRequestFromCli(await parseFlowAction([command, ...args])) as WorktreeRequest & { command: K }
}

/** The handler context for `taskflow <command> <args...>`. */
async function cli(context: { command: WorktreeRequest['command']; args: string[]; projectDir: string; port: number }) {
  return { request: await parse(context.command, context.args), projectDir: context.projectDir, port: context.port }
}

function stubLifecycleService(calls: Array<{ method: string; value: unknown }>) {
  return {
    async createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: 'createWorktree', value: input })
      return { branch: input.branch ?? 'generated-branch', worktreeId: 'wt-1' }
    },
    async createWorktrees(
      input: CreateLifecycleWorktreesInput,
    ): Promise<{ primaryBranch: string; branches: string[] }> {
      calls.push({ method: 'createWorktrees', value: input })
      const branch = input.branch ?? 'generated-branch'
      const selectedAgents = input.agents ?? (input.agent ? [input.agent] : ['claude'])
      const branches = selectedAgents.length > 1 ? selectedAgents.map((agent) => `${agent}/${branch}`) : [branch]
      return { primaryBranch: branches[0] ?? branch, branches }
    },
    async openWorktree(
      branch: string,
      options?: { interfaceMode?: 'terminal' | 'web_chat' },
    ): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: 'openWorktree', value: options ? { branch, ...options } : branch })
      return { branch, worktreeId: 'wt-2' }
    },
    async closeWorktree(branch: string): Promise<void> {
      calls.push({ method: 'closeWorktree', value: branch })
    },
    async refreshAgentTerminal(branch: string): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: 'refreshAgentTerminal', value: branch })
      return { branch, worktreeId: 'wt-3' }
    },
    async setWorktreeArchived(branch: string, archived: boolean): Promise<void> {
      calls.push({ method: 'setWorktreeArchived', value: { branch, archived } })
    },
    async setWorktreeLabel(branch: string, label: string | null): Promise<{ label: string | null }> {
      calls.push({ method: 'setWorktreeLabel', value: { branch, label } })
      return { label }
    },
    async setWorktreeProfile(branch: string, profile: string): Promise<{ profile: string; restarted: boolean }> {
      calls.push({ method: 'setWorktreeProfile', value: { branch, profile } })
      return { profile, restarted: true }
    },
    async removeWorktree(branch: string, options?: RemoveWorktreeOptions): Promise<void> {
      calls.push({ method: 'removeWorktree', value: { branch, force: options?.force === true } })
    },
    async mergeWorktree(branch: string): Promise<void> {
      calls.push({ method: 'mergeWorktree', value: branch })
    },
    async pruneWorktrees(): Promise<PruneWorktreesResult> {
      calls.push({ method: 'pruneWorktrees', value: null })
      return { removedBranches: ['feature/search', 'feature/api'], keptBranches: [] }
    },
  }
}

function stubGit(worktrees: Array<{ path: string; branch: string | null; bare: boolean }> = []) {
  return {
    listWorktrees: () => worktrees,
    resolveWorktreeGitDir: (cwd: string) => `${cwd}/.git`,
  }
}

function stubSessions(windows: Array<{ sessionName: string; windowName: string }> = []) {
  return { listWindows: async () => windows, focusWindow: async () => {} }
}

function makeRuntime() {
  const calls: Array<{ method: string; value: unknown }> = []

  return {
    calls,
    runtime: {
      projectDir: '/repo',
      config: {
        multiplexer: 'tmux' as const,
        workspace: {
          mainBranch: 'develop',
        },
      },
      git: stubGit(),
      sessions: stubSessions(),
      lifecycleService: stubLifecycleService(calls),
    },
  }
}

describe('add parsing', () => {
  it('parses the CLI add contract into lifecycle input', async () => {
    expect(
      (
        await parse('add', [
          'feature/search',
          '--base',
          'release/2026.03',
          '--profile',
          'sandbox',
          '--agent=codex',
          '--prompt',
          'Fix the search ranking',
          '--env',
          'FOO=bar',
          '--env=BAR=baz',
          '--interface',
          'web-chat',
        ])
      ).add,
    ).toEqual({
      input: {
        branch: 'feature/search',
        baseBranch: 'release/2026.03',
        profile: 'sandbox',
        agents: ['codex'],
        prompt: 'Fix the search ranking',
        envOverrides: {
          FOO: 'bar',
          BAR: 'baz',
        },
        interfaceMode: 'web_chat',
      },
      detach: false,
      fromLinearIssueId: null,
      branchExplicit: true,
    } satisfies ParsedAddCommand)
  })

  it('parses --existing flag', async () => {
    expect((await parse('add', ['feature/search', '--existing'])).add).toEqual({
      input: { branch: 'feature/search', mode: 'existing' },
      detach: false,
      fromLinearIssueId: null,
      branchExplicit: true,
    })
  })

  it('parses --existing with other flags', async () => {
    expect((await parse('add', ['feature/search', '--existing', '--agent', 'claude', '--detach'])).add).toEqual({
      input: { branch: 'feature/search', mode: 'existing', agents: ['claude'] },
      detach: true,
      fromLinearIssueId: null,
      branchExplicit: true,
    })
  })

  it('parses --detach flag', async () => {
    expect((await parse('add', ['feature/search', '--detach'])).add).toEqual({
      input: { branch: 'feature/search' },
      detach: true,
      fromLinearIssueId: null,
      branchExplicit: true,
    })
  })

  it('parses -d shorthand', async () => {
    expect((await parse('add', ['-d', 'feature/search'])).add).toEqual({
      input: { branch: 'feature/search' },
      detach: true,
      fromLinearIssueId: null,
      branchExplicit: true,
    })
  })

  it('parses repeated --agent flags', async () => {
    expect((await parse('add', ['feature/search', '--agent=claude', '--agent', 'gemini'])).add).toEqual({
      input: { branch: 'feature/search', agents: ['claude', 'gemini'] },
      detach: false,
      fromLinearIssueId: null,
      branchExplicit: true,
    })
  })

  it('rejects empty agent ids', async () => {
    await expect(parse('add', ['feature/search', '--agent', '   '])).rejects.toThrow('Agent id cannot be empty')
  })

  it('parses --from-linear', async () => {
    expect((await parse('add', ['--from-linear', 'ENG-12'])).add).toEqual({
      input: {},
      detach: false,
      fromLinearIssueId: 'ENG-12',
      branchExplicit: false,
    })
  })

  it('rejects malformed --from-linear values', async () => {
    await expect(parse('add', ['--from-linear', 'eng-1'])).rejects.toThrow(
      '--from-linear expects an issue id like ENG-123',
    )
  })

  it('accepts --branch override alongside --from-linear', async () => {
    const parsed = (await parse('add', ['--from-linear', 'ENG-12', '--branch', 'feat/override'])).add
    expect(parsed?.input.branch).toBe('feat/override')
    expect(parsed?.branchExplicit).toBe(true)
    expect(parsed?.fromLinearIssueId).toBe('ENG-12')
  })
})

describe('branch parsing', () => {
  it('parses the required branch argument', async () => {
    expect((await parse('close', ['feature/search'])).branch).toBe('feature/search')
  })

  it('rejects invalid worktree names', async () => {
    await expect(parse('close', ['feature..search'])).rejects.toThrow('Invalid worktree name')
  })
})

describe('open parsing', () => {
  it('parses the session interface', async () => {
    expect(await parse('open', ['feature/search', '--interface', 'web-chat'])).toEqual({
      command: 'open',
      branch: 'feature/search',
      interfaceMode: 'web_chat',
    })
  })

  it('rejects unknown session interfaces', async () => {
    await expect(parse('open', ['feature/search', '--interface', 'desktop'])).rejects.toThrow(
      '--interface must be "terminal" or "web-chat"',
    )
  })
})

describe('tab parsing', () => {
  it('defaults to the list action', async () => {
    expect((await parse('tab', ['feature'])).tab).toEqual({ branch: 'feature', action: 'list' })
  })

  it('parses the new action', async () => {
    expect((await parse('tab', ['feature', 'new'])).tab).toEqual({ branch: 'feature', action: 'new' })
  })

  it('parses switch and close with a tab id', async () => {
    expect((await parse('tab', ['feature', 'switch', 'fork-2'])).tab).toEqual({
      branch: 'feature',
      action: 'switch',
      tabId: 'fork-2',
    })
    expect((await parse('tab', ['feature', 'close', 'fork-2'])).tab).toEqual({
      branch: 'feature',
      action: 'close',
      tabId: 'fork-2',
    })
  })

  it('requires a tab id for switch and close', async () => {
    await expect(parse('tab', ['feature', 'switch'])).rejects.toThrow('requires a <tabId>')
    await expect(parse('tab', ['feature', 'close'])).rejects.toThrow('requires a <tabId>')
  })

  it('rejects unknown actions and missing branch', async () => {
    await expect(parse('tab', ['feature', 'bogus'])).rejects.toThrow('Allowed choices are list, new, switch, close')
    await expect(parse('tab', [])).rejects.toThrow("missing required argument 'branch'")
  })
})

describe('list parsing', () => {
  it('parses list filters', async () => {
    expect((await parse('list', ['--all', '--search', 'search'])).list).toEqual({
      mode: 'all',
      search: 'search',
    })
  })

  it('rejects conflicting archive filters', async () => {
    await expect(parse('list', ['--all', '--archived'])).rejects.toThrow(
      "option '--all' cannot be used with option '--archived'",
    )
  })
})

describe('send parsing', () => {
  it('parses positional branch and prompt', async () => {
    expect((await parse('send', ['feature/search', 'Fix the bug'])).send).toEqual({
      branch: 'feature/search',
      text: 'Fix the bug',
    } satisfies ParsedSendCommand)
  })

  it('parses --prompt flag instead of positional', async () => {
    expect((await parse('send', ['feature/search', '--prompt', 'Fix the bug'])).send).toEqual({
      branch: 'feature/search',
      text: 'Fix the bug',
    })
  })

  it('parses --preamble flag', async () => {
    expect(
      (await parse('send', ['feature/search', 'Fix the bug', '--preamble', 'You are a helpful assistant'])).send,
    ).toEqual({
      branch: 'feature/search',
      text: 'Fix the bug',
      preamble: 'You are a helpful assistant',
    })
  })

  it('throws on missing branch', async () => {
    await expect(parse('send', [])).rejects.toThrow("missing required argument 'branch'")
  })

  it('throws on missing prompt', async () => {
    await expect(parse('send', ['feature/search'])).rejects.toThrow('Missing required argument: <prompt>')
  })

  it('throws on invalid branch name', async () => {
    await expect(parse('send', ['feature..search', 'Fix it'])).rejects.toThrow('Invalid worktree name')
  })

  it('rejects --prompt when positional prompt is already set', async () => {
    await expect(parse('send', ['feature/search', 'Fix the bug', '--prompt', 'other'])).rejects.toThrow(
      'Cannot use --prompt with a positional prompt argument',
    )
  })
})

describe('label parsing', () => {
  it('parses branch and label text', async () => {
    expect((await parse('label', ['feature/search', 'Search', 'ranking'])).label).toEqual({
      branch: 'feature/search',
      label: 'Search ranking',
    })
  })

  it('parses --clear', async () => {
    expect((await parse('label', ['feature/search', '--clear'])).label).toEqual({
      branch: 'feature/search',
      label: null,
    })
  })

  it('parses --label', async () => {
    expect((await parse('label', ['feature/search', '--label', 'Search ranking'])).label).toEqual({
      branch: 'feature/search',
      label: 'Search ranking',
    })
  })

  it('rejects --clear with label text', async () => {
    await expect(parse('label', ['feature/search', '--clear', 'Search'])).rejects.toThrow(
      'Cannot use --clear with a label',
    )
  })

  it('rejects --label with positional label text', async () => {
    await expect(parse('label', ['feature/search', '--label', 'Search', 'extra'])).rejects.toThrow(
      'Cannot use --label with a positional label',
    )
  })
})

describe('profile parsing', () => {
  it('parses branch and profile name', async () => {
    expect((await parse('profile', ['feature/search', 'full'])).profile).toEqual({
      branch: 'feature/search',
      profile: 'full',
    })
  })

  it('parses --profile', async () => {
    expect((await parse('profile', ['feature/search', '--profile=full'])).profile).toEqual({
      branch: 'feature/search',
      profile: 'full',
    })
  })

  it('requires a profile name', async () => {
    await expect(parse('profile', ['feature/search'])).rejects.toThrow('Missing required argument: <profile>')
  })

  it('rejects --profile with a positional profile', async () => {
    await expect(parse('profile', ['feature/search', '--profile', 'full', 'slim'])).rejects.toThrow(
      'Cannot use --profile with a positional profile',
    )
  })

  it('rejects invalid worktree names', async () => {
    await expect(parse('profile', ['feature..search', 'full'])).rejects.toThrow('Invalid worktree name')
  })
})

describe('runWorktreeCommand', () => {
  it('dispatches add through the lifecycle service and switches to tmux', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []
    const stderr: string[] = []
    const switchCalls: Array<{ projectDir: string; branch: string }> = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'add',
        args: ['feature/search', '--base', 'release/base', '--agent', 'codex', '--env', 'FOO=bar'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
        switchToSessionWindow: (projectDir, branch) => {
          switchCalls.push({ projectDir, branch })
        },
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      {
        method: 'createWorktrees',
        value: {
          branch: 'feature/search',
          baseBranch: 'release/base',
          agents: ['codex'],
          envOverrides: { FOO: 'bar' },
        },
      },
    ])
    expect(stdout).toEqual(['Created worktree feature/search'])
    expect(stderr).toEqual([])
    expect(switchCalls).toEqual([{ projectDir: '/repo', branch: 'feature/search' }])
  })

  it('dispatches add --existing with mode existing', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'add',
        args: ['feature/remote-branch', '--existing'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToSessionWindow: () => {},
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      {
        method: 'createWorktrees',
        value: {
          branch: 'feature/remote-branch',
          mode: 'existing',
        },
      },
    ])
    expect(stdout).toEqual(['Created worktree feature/remote-branch'])
  })

  it('passes the server-resolved project prefix to the runtime so control.env carries it', async () => {
    const { runtime } = makeRuntime()
    const createdWith: Array<{ prefix?: string }> = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'add',
        args: ['feature/search', '--detach'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: (options) => {
          createdWith.push({ prefix: options.prefix })
          return runtime
        },
        resolveProjectPrefix: async () => 'myproject',
        stdout: () => {},
        switchToSessionWindow: () => {},
      },
    )

    expect(exitCode).toBe(0)
    expect(createdWith).toEqual([{ prefix: 'myproject' }])
  })

  it('skips tmux switch when --detach is passed to add', async () => {
    const { runtime } = makeRuntime()
    const stdout: string[] = []
    const switchCalls: Array<{ projectDir: string; branch: string }> = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'add',
        args: ['feature/search', '--detach'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToSessionWindow: (projectDir, branch) => {
          switchCalls.push({ projectDir, branch })
        },
      },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toEqual(['Created worktree feature/search'])
    expect(switchCalls).toEqual([])
  })

  it('dispatches repeated --agent flags through createWorktrees and switches to primary branch', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []
    const switchCalls: Array<{ projectDir: string; branch: string }> = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'add',
        args: ['feature/search', '--agent=claude', '--agent=codex'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToSessionWindow: (projectDir, branch) => {
          switchCalls.push({ projectDir, branch })
        },
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      {
        method: 'createWorktrees',
        value: {
          branch: 'feature/search',
          agents: ['claude', 'codex'],
        },
      },
    ])
    expect(stdout).toEqual(['Created worktree claude/feature/search', 'Created worktree codex/feature/search'])
    expect(switchCalls).toEqual([{ projectDir: '/repo', branch: 'claude/feature/search' }])
  })

  it('dispatches open through the lifecycle service and switches to tmux', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []
    const switchCalls: Array<{ projectDir: string; branch: string }> = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'open',
        args: ['feature/search'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToSessionWindow: (projectDir, branch) => {
          switchCalls.push({ projectDir, branch })
        },
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'openWorktree', value: 'feature/search' }])
    expect(stdout).toEqual(['Opened worktree feature/search'])
    expect(switchCalls).toEqual([{ projectDir: '/repo', branch: 'feature/search' }])
  })

  it('opens a session in Web Chat mode from the CLI', async () => {
    const { runtime, calls } = makeRuntime()

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'open',
        args: ['feature/search', '--interface=web-chat'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        switchToSessionWindow: () => {},
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'openWorktree', value: { branch: 'feature/search', interfaceMode: 'web_chat' } }])
  })

  it('dispatches refresh through the lifecycle service', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'refresh',
        args: ['feature/search'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'refreshAgentTerminal', value: 'feature/search' }])
    expect(stdout).toEqual(['Refreshed agent terminal for feature/search'])
  })

  it('dispatches archive through the lifecycle service', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'archive',
        args: ['feature/search'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'setWorktreeArchived', value: { branch: 'feature/search', archived: true } }])
    expect(stdout).toEqual(['Archived worktree feature/search'])
  })

  it('dispatches label updates through the lifecycle service', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'label',
        args: ['feature/search', 'Search', 'ranking'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      { method: 'setWorktreeLabel', value: { branch: 'feature/search', label: 'Search ranking' } },
    ])
    expect(stdout).toEqual(['Labeled worktree feature/search as "Search ranking"'])
  })

  it('dispatches label clears through the lifecycle service', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'label',
        args: ['feature/search', '--clear'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'setWorktreeLabel', value: { branch: 'feature/search', label: null } }])
    expect(stdout).toEqual(['Cleared label for feature/search'])
  })

  it('dispatches profile switches through the lifecycle service', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'profile',
        args: ['feature/search', 'full'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'setWorktreeProfile', value: { branch: 'feature/search', profile: 'full' } }])
    expect(stdout).toEqual(['Switched feature/search to profile "full" and restarted the session'])
  })

  it('prints the configured merge target on success', async () => {
    const { runtime, calls } = makeRuntime()
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'merge',
        args: ['feature/search'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([{ method: 'mergeWorktree', value: 'feature/search' }])
    expect(stdout).toEqual(['Merged feature/search into develop'])
  })

  // Discarding work that lives only in a worktree is what --force is for, so
  // the flag has to reach the service rather than being dropped in parsing.
  it('passes --force to the removal, and withholds it otherwise', async () => {
    for (const [args, force] of [
      [['feature/search'], false],
      [['feature/search', '--force'], true],
    ] as const) {
      const { runtime, calls } = makeRuntime()
      const exitCode = await runWorktreeCommand(
        await cli({ command: 'remove', args: [...args], projectDir: '/repo', port: 5111 }),
        { createRuntime: () => runtime, stdout: () => {} },
      )

      expect(exitCode).toBe(0)
      expect(calls).toEqual([{ method: 'removeWorktree', value: { branch: 'feature/search', force } }])
    }
  })

  it('reports the worktrees a prune kept, with the work it found in them', async () => {
    const { runtime, calls } = makeRuntime()
    runtime.lifecycleService.pruneWorktrees = async (): Promise<PruneWorktreesResult> => {
      calls.push({ method: 'pruneWorktrees', value: null })
      return {
        removedBranches: ['feature/api'],
        keptBranches: [{ branch: 'feature/search', reason: 'uncommitted changes' }],
      }
    }
    runtime.git = stubGit([
      { path: '/repo', branch: 'main', bare: false },
      { path: '/repo/.worktrees/feature-search', branch: 'feature/search', bare: false },
      { path: '/repo/.worktrees/feature-api', branch: 'feature/api', bare: false },
    ])
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'prune', args: [], projectDir: '/repo', port: 5111 }),
      { createRuntime: () => runtime, confirmPrune: async () => true, stdout: (message) => stdout.push(message) },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toEqual(['Kept feature/search: uncommitted changes', 'Pruned 1 worktree: feature/api'])
  })

  it('prunes closed worktrees after confirmation', async () => {
    const { runtime, calls } = makeRuntime()
    runtime.git = stubGit([
      { path: '/repo', branch: 'main', bare: false },
      { path: '/repo/.worktrees/feature-search', branch: 'feature/search', bare: false },
      { path: '/repo/.worktrees/feature-api', branch: 'feature/api', bare: false },
    ])
    const stdout: string[] = []
    const confirmCalls: number[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'prune',
        args: [],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        confirmPrune: async (count) => {
          confirmCalls.push(count)
          return true
        },
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(confirmCalls).toEqual([2])
    expect(calls).toEqual([{ method: 'pruneWorktrees', value: null }])
    expect(stdout).toEqual(['Pruned 2 worktrees: feature/search, feature/api'])
  })

  it('counts only closed worktrees toward the prune confirmation', async () => {
    const { runtime, calls } = makeRuntime()
    runtime.git = stubGit([
      { path: '/repo', branch: 'main', bare: false },
      { path: '/repo/.worktrees/feature-search', branch: 'feature/search', bare: false },
      { path: '/repo/.worktrees/feature-api', branch: 'feature/api', bare: false },
    ])
    runtime.sessions = stubSessions([
      { sessionName: buildProjectSessionName('/repo'), windowName: buildWorktreeWindowName('feature/api') },
    ])
    const stdout: string[] = []
    const confirmCalls: number[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'prune',
        args: [],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        confirmPrune: async (count) => {
          confirmCalls.push(count)
          return true
        },
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(confirmCalls).toEqual([1])
    expect(calls).toEqual([{ method: 'pruneWorktrees', value: null }])
  })

  it('does not prune when every worktree is open', async () => {
    const { runtime, calls } = makeRuntime()
    runtime.git = stubGit([
      { path: '/repo', branch: 'main', bare: false },
      { path: '/repo/.worktrees/feature-search', branch: 'feature/search', bare: false },
    ])
    runtime.sessions = stubSessions([
      { sessionName: buildProjectSessionName('/repo'), windowName: buildWorktreeWindowName('feature/search') },
    ])
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'prune',
        args: [],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        confirmPrune: async () => true,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([])
    expect(stdout).toEqual(['No closed worktrees to prune.'])
  })

  it('aborts prune when confirmation is declined', async () => {
    const { runtime, calls } = makeRuntime()
    runtime.git = stubGit([
      { path: '/repo', branch: 'main', bare: false },
      { path: '/repo/.worktrees/feature-search', branch: 'feature/search', bare: false },
    ])
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'prune',
        args: [],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => runtime,
        confirmPrune: async () => false,
        stdout: (message) => stdout.push(message),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([])
    expect(stdout).toEqual(['Aborted.'])
  })

  it('returns a failing exit code when lifecycle execution fails', async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({
        command: 'remove',
        args: ['feature/search'],
        projectDir: '/repo',
        port: 5111,
      }),
      {
        createRuntime: () => ({
          projectDir: '/repo',
          config: {
            multiplexer: 'tmux' as const,
            workspace: {
              mainBranch: 'main',
            },
          },
          git: stubGit(),
          sessions: stubSessions(),
          lifecycleService: {
            async createWorktree(): Promise<{ branch: string; worktreeId: string }> {
              throw new Error('not used')
            },
            async createWorktrees(): Promise<{ primaryBranch: string; branches: string[] }> {
              throw new Error('not used')
            },
            async openWorktree(): Promise<{ branch: string; worktreeId: string }> {
              throw new Error('not used')
            },
            async closeWorktree(): Promise<void> {
              throw new Error('not used')
            },
            async refreshAgentTerminal(): Promise<{ branch: string; worktreeId: string }> {
              throw new Error('not used')
            },
            async setWorktreeArchived(): Promise<void> {
              throw new Error('not used')
            },
            async setWorktreeLabel(): Promise<{ label: string | null }> {
              throw new Error('not used')
            },
            async setWorktreeProfile(): Promise<{ profile: string; restarted: boolean }> {
              throw new Error('not used')
            },
            async removeWorktree(): Promise<void> {
              throw new Error('Worktree has uncommitted changes: feature/search')
            },
            async mergeWorktree(): Promise<void> {
              throw new Error('not used')
            },
            async pruneWorktrees(): Promise<PruneWorktreesResult> {
              throw new Error('not used')
            },
          },
        }),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout).toEqual([])
    expect(stderr).toEqual(['Error: Worktree has uncommitted changes: feature/search'])
  })

  it('lists worktrees with open/closed status', async () => {
    const sessionName = buildProjectSessionName('/repo')
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'list', args: [], projectDir: '/repo', port: 5111 }),
      {
        createRuntime: () => ({
          projectDir: '/repo',
          config: { multiplexer: 'tmux' as const, workspace: { mainBranch: 'main' } },
          git: stubGit([
            { path: '/repo', branch: 'main', bare: false },
            { path: '/repo/.worktrees/fix-bug', branch: 'fix-bug', bare: false },
            { path: '/repo/.worktrees/my-feature', branch: 'my-feature', bare: false },
          ]),
          sessions: stubSessions([{ sessionName, windowName: buildWorktreeWindowName('my-feature') }]),
          lifecycleService: stubLifecycleService([]),
        }),
        stdout: (msg) => stdout.push(msg),
      },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toHaveLength(2)
    expect(stdout[0]).toContain('my-feature')
    expect(stdout[0]).toContain('open')
    expect(stdout[1]).toContain('fix-bug')
    expect(stdout[1]).toContain('closed')
  })

  it('lists and searches workspace labels', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'taskflow-cli-labels-'))
    try {
      const projectDir = join(tempDir, 'repo')
      const worktreePath = join(projectDir, '.worktrees', 'random-name')
      const metaDir = join(worktreePath, '.git', 'portta')
      await mkdir(metaDir, { recursive: true })
      await nodeTest.write(
        join(metaDir, 'meta.json'),
        JSON.stringify({
          schemaVersion: 1,
          worktreeId: 'wt_random',
          branch: 'random-name',
          label: 'Search ranking',
          createdAt: '2026-05-12T00:00:00.000Z',
          profile: 'default',
          agent: 'codex',
          runtime: 'host',
          startupEnvValues: {},
          allocatedPorts: {},
        }),
      )
      const stdout: string[] = []

      const exitCode = await runWorktreeCommand(
        await cli({ command: 'list', args: ['--search', 'ranking'], projectDir, port: 5111 }),
        {
          createRuntime: () => ({
            projectDir,
            config: { multiplexer: 'tmux' as const, workspace: { mainBranch: 'main' } },
            git: stubGit([
              { path: projectDir, branch: 'main', bare: false },
              { path: worktreePath, branch: 'random-name', bare: false },
            ]),
            sessions: stubSessions(),
            lifecycleService: stubLifecycleService([]),
          }),
          stdout: (msg) => stdout.push(msg),
        },
      )

      expect(exitCode).toBe(0)
      expect(stdout).toHaveLength(1)
      expect(stdout[0]).toContain('Search ranking (random-name)')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('prints empty message when no worktrees exist', async () => {
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'list', args: [], projectDir: '/repo', port: 5111 }),
      {
        createRuntime: () => ({
          projectDir: '/repo',
          config: { multiplexer: 'tmux' as const, workspace: { mainBranch: 'main' } },
          git: stubGit([{ path: '/repo', branch: 'main', bare: false }]),
          sessions: stubSessions(),
          lifecycleService: stubLifecycleService([]),
        }),
        stdout: (msg) => stdout.push(msg),
      },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toEqual(['No worktrees found.'])
  })

  describe('send', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('sends the correct HTTP request to the server', async () => {
      const fetchCalls: Array<{ url: string; init: RequestInit }> = []
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init: init! })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }) as typeof fetch

      const stdout: string[] = []
      const exitCode = await runWorktreeCommand(
        await cli({
          command: 'send',
          args: ['feature/search', 'Fix the bug', '--preamble', 'Be concise'],
          projectDir: '/repo',
          port: 5111,
        }),
        {
          createRuntime: () => {
            throw new Error('unexpected')
          },
          resolveBaseUrl: async () => 'http://localhost:5111/myproject',
          stdout: (msg) => stdout.push(msg),
        },
      )

      expect(exitCode).toBe(0)
      expect(stdout).toEqual(['Sent prompt to feature/search'])
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0]!.url).toBe('http://localhost:5111/myproject/api/worktrees/feature%2Fsearch/send')
      expect(fetchCalls[0]!.init.method).toBe('POST')
      expect(JSON.parse(fetchCalls[0]!.init.body as string)).toEqual({
        text: 'Fix the bug',
        preamble: 'Be concise',
      })
    })

    it('reports server errors with the error message', async () => {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ error: 'Worktree not found: no-such' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      const stderr: string[] = []
      const exitCode = await runWorktreeCommand(
        await cli({
          command: 'send',
          args: ['no-such', 'Fix it'],
          projectDir: '/repo',
          port: 5111,
        }),
        {
          createRuntime: () => {
            throw new Error('unexpected')
          },
          resolveBaseUrl: async () => 'http://localhost:5111/myproject',
          stderr: (msg) => stderr.push(msg),
        },
      )

      expect(exitCode).toBe(1)
      expect(stderr).toEqual(['Error: Worktree not found: no-such'])
    })

    it('shows a friendly message when the server is unreachable', async () => {
      globalThis.fetch = (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch

      const stderr: string[] = []
      const exitCode = await runWorktreeCommand(
        await cli({
          command: 'send',
          args: ['feature/search', 'Fix it'],
          projectDir: '/repo',
          port: 9999,
        }),
        {
          createRuntime: () => {
            throw new Error('unexpected')
          },
          resolveBaseUrl: async () => 'http://localhost:9999/myproject',
          stderr: (msg) => stderr.push(msg),
        },
      )

      expect(exitCode).toBe(1)
      expect(stderr).toEqual([`Error: ${daemonUnreachableHint(9999)}`])
    })
  })
})

describe('runWorktreeCommand restore', () => {
  const SESSION = buildProjectSessionName('/repo')

  function makeRestoreRuntime(options: {
    worktrees?: Array<{ path: string; branch: string | null; bare: boolean }>
    windows?: Array<{ sessionName: string; windowName: string }>
    openWorktree?: (branch: string) => Promise<{ branch: string; worktreeId: string }>
  }) {
    const opened: string[] = []
    return {
      opened,
      runtime: {
        projectDir: '/repo',
        config: { multiplexer: 'tmux' as const, workspace: { mainBranch: 'main' } },
        git: {
          listWorktrees: () => options.worktrees ?? [],
          resolveWorktreeGitDir: (cwd: string) => `${cwd}/.git`,
        },
        sessions: { listWindows: async () => options.windows ?? [], focusWindow: async () => {} },
        lifecycleService: {
          ...stubLifecycleService([]),
          async openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }> {
            if (options.openWorktree) return options.openWorktree(branch)
            opened.push(branch)
            return { branch, worktreeId: `wt-${branch}` }
          },
        },
      },
    }
  }

  it('re-opens saved sessions that are not already open', async () => {
    const { runtime, opened } = makeRestoreRuntime({
      worktrees: [
        { path: '/repo', branch: 'main', bare: false },
        { path: '/repo/wt/feature-a', branch: 'feature-a', bare: false },
        { path: '/repo/wt/feature-b', branch: 'feature-b', bare: false },
      ],
      windows: [{ sessionName: SESSION, windowName: buildWorktreeWindowName('feature-b') }],
    })
    const stdout: string[] = []
    const stderr: string[] = []
    const switchCalls: Array<{ projectDir: string; branch: string }> = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'restore', args: [], projectDir: '/repo', port: 5111 }),
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        switchToSessionWindow: (projectDir, branch) => {
          switchCalls.push({ projectDir, branch })
        },
        readOpenSessions: async () => ({
          schemaVersion: 1,
          savedAt: '2026-06-27T12:00:00.000Z',
          branches: ['feature-a', 'feature-b'],
        }),
      },
    )

    expect(exitCode).toBe(0)
    expect(opened).toEqual(['feature-a'])
    expect(stdout).toEqual(['Restored feature-a', 'Already open: feature-b', 'Restored 1 session, skipped 1.'])
    expect(stderr).toEqual([])
    expect(switchCalls).toEqual([{ projectDir: '/repo', branch: 'feature-a' }])
  })

  it('reports when there are no saved sessions', async () => {
    const { runtime } = makeRestoreRuntime({})
    const stdout: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'restore', args: [], projectDir: '/repo', port: 5111 }),
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        switchToSessionWindow: () => {},
        readOpenSessions: async () => ({ schemaVersion: 1, savedAt: '', branches: [] }),
      },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toEqual(['No saved sessions to restore.'])
  })

  it('skips saved branches whose worktree no longer exists', async () => {
    const { runtime, opened } = makeRestoreRuntime({
      worktrees: [{ path: '/repo', branch: 'main', bare: false }],
    })
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'restore', args: [], projectDir: '/repo', port: 5111 }),
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        switchToSessionWindow: () => {},
        readOpenSessions: async () => ({ schemaVersion: 1, savedAt: 'x', branches: ['gone'] }),
      },
    )

    expect(exitCode).toBe(0)
    expect(opened).toEqual([])
    expect(stderr).toEqual(['Skipping gone: worktree no longer exists'])
    expect(stdout).toEqual(['Restored 0 sessions, skipped 1.'])
  })

  it('returns exit code 1 and reports when a restore fails', async () => {
    const { runtime } = makeRestoreRuntime({
      worktrees: [
        { path: '/repo', branch: 'main', bare: false },
        { path: '/repo/wt/feature-a', branch: 'feature-a', bare: false },
      ],
      openWorktree: async (branch) => {
        throw new Error(`boom ${branch}`)
      },
    })
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'restore', args: [], projectDir: '/repo', port: 5111 }),
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        switchToSessionWindow: () => {},
        readOpenSessions: async () => ({ schemaVersion: 1, savedAt: 'x', branches: ['feature-a'] }),
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr).toEqual(['Failed to restore feature-a: boom feature-a'])
    expect(stdout).toEqual(['Restored 0 sessions, 1 failed.'])
  })
})

describe('runWorktreeCommand multiplexer', () => {
  it('prints the current multiplexer when given no target', async () => {
    const stdout: string[] = []
    const { runtime } = makeRuntime()

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'multiplexer', args: [], projectDir: '/repo', port: 5111 }),
      { createRuntime: () => runtime, stdout: (m) => stdout.push(m), resolveProjectPrefix: async () => undefined },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toEqual(['tmux'])
  })

  it('no-ops when already on the requested multiplexer', async () => {
    const stdout: string[] = []
    const { runtime, calls } = makeRuntime()

    const exitCode = await runWorktreeCommand(
      await cli({ command: 'multiplexer', args: ['tmux'], projectDir: '/repo', port: 5111 }),
      { createRuntime: () => runtime, stdout: (m) => stdout.push(m), resolveProjectPrefix: async () => undefined },
    )

    expect(exitCode).toBe(0)
    expect(stdout).toEqual(['Already using tmux.'])
    expect(calls).toEqual([])
  })

  it('closes on the outgoing runtime and reopens on one built after the config flip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-mux-'))
    try {
      const order: string[] = []
      const sessionName = buildProjectSessionName(dir)
      const runtimes: Array<{ calls: Array<{ method: string; value: unknown }> }> = []

      const createRuntime = (): ReturnType<typeof makeRuntime>['runtime'] => {
        const made = makeRuntime()
        runtimes.push({ calls: made.calls })
        const index = runtimes.length - 1
        // Only the first (outgoing) runtime sees the worktree as open.
        made.runtime.projectDir = dir
        made.runtime.git = stubGit([{ path: join(dir, 'alpha'), branch: 'alpha', bare: false }])
        made.runtime.sessions = stubSessions(
          index === 0 ? [{ sessionName, windowName: buildWorktreeWindowName('alpha') }] : [],
        )
        made.runtime.lifecycleService = {
          ...made.runtime.lifecycleService,
          async closeWorktree(branch: string): Promise<void> {
            order.push(`close@${index}:${branch}`)
          },
          async openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }> {
            order.push(`open@${index}:${branch}`)
            return { branch, worktreeId: 'wt' }
          },
        }
        return made.runtime
      }

      const stdout: string[] = []
      const exitCode = await runWorktreeCommand(
        await cli({ command: 'multiplexer', args: ['herdr'], projectDir: dir, port: 5111 }),
        { createRuntime, stdout: (m) => stdout.push(m), resolveProjectPrefix: async () => undefined },
      )

      expect(exitCode).toBe(0)
      // closed on runtime 0 (tmux), reopened on runtime 1 (built after persist → herdr)
      expect(order).toEqual(['close@0:alpha', 'open@1:alpha'])
      expect(runtimes.length).toBe(2)

      const written = await nodeTest.file(join(dir, '.portta/taskflow.local.yaml')).text()
      expect(written).toContain('multiplexer: herdr')
      expect(stdout.join('\n')).toContain('Switched tmux → herdr (1/1 reopened)')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
