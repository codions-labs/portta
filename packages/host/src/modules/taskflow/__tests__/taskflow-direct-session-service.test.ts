import { describe, expect, it } from 'vitest'
import type { SessionDiscoveryGateway } from '../adapters/session-discovery.ts'
import type { SessionGateway } from '../adapters/session-gateway.ts'
import type { DirectSessionStartInput } from '../services/direct-session-port.ts'
import { TaskflowDirectSessionService } from '../services/taskflow-direct-session-service.ts'

function fakeSessions(): { sessions: SessionGateway; commands: string[] } {
  const windows = new Set<string>()
  const commands: string[] = []
  const sessions: SessionGateway = {
    ensureServer: async (): Promise<void> => {},
    ensureSession: async (): Promise<void> => {},
    hasWindow: async (sessionName: string, windowName: string): Promise<boolean> =>
      windows.has(`${sessionName}:${windowName}`),
    killWindow: async (sessionName: string, windowName: string): Promise<void> => {
      windows.delete(`${sessionName}:${windowName}`)
    },
    createWindow: async (options): Promise<void> => {
      windows.add(`${options.sessionName}:${options.windowName}`)
      commands.push(options.command ?? '')
    },
    splitWindow: async (): Promise<void> => {},
    runCommand: async (): Promise<void> => {},
    selectPane: async (): Promise<void> => {},
    focusWindow: async (): Promise<void> => {},
    listWindows: async () => [],
    getPaneId: async (target: string): Promise<string> => `pane:${target}`,
    createParkedPane: async (): Promise<string> => 'pane:parked',
    swapPanes: async (): Promise<void> => {},
    killPane: async (): Promise<void> => {},
  }
  return { sessions, commands }
}

function startInput(): DirectSessionStartInput {
  return {
    run: {
      id: 'run_01',
      projectId: 'project_01',
      mode: 'direct',
      input: 'Fix the failing test',
      status: 'provisioning',
      workspacePolicy: 'run',
      workflowSnapshotId: null,
      environmentId: null,
      workspaceId: 'workspace_01',
      worktreePath: '/repo/__worktrees/run',
      canonicalWorkspacePath: '/repo/__worktrees/run',
      branch: 'taskflow/run-01',
      baseBranch: 'main',
      baseCommit: 'abc',
      profile: 'default',
      engineKind: null,
      engineRunId: null,
      error: null,
      result: null,
      operationId: 'operation_01',
      createdAt: '2026-09-09T12:00:00.000Z',
      updatedAt: '2026-09-09T12:00:00.000Z',
      startedAt: null,
      completedAt: null,
      issueRef: null,
    },
    workspace: {
      workspaceId: 'workspace_01',
      path: '/repo/__worktrees/run',
      canonicalPath: '/repo/__worktrees/run',
      branch: 'taskflow/run-01',
      baseBranch: 'main',
      baseCommit: 'abc',
      strategy: 'isolated_worktree',
      access: 'exclusive_write',
    },
    harness: 'codex',
    provider: null,
    model: 'gpt-5.6-codex',
    transport: 'native',
    permissionMode: 'interactive',
    mcpServers: [],
  }
}

describe('TaskflowDirectSessionService', () => {
  it('stores the provider session id and resumes it in the Run worktree window', async () => {
    const { sessions, commands } = fakeSessions()
    const discovered: string[][] = [[], ['provider-session-1']]
    const sessionDiscovery: SessionDiscoveryGateway = {
      listSessionIds: async () => discovered.shift() ?? ['provider-session-1'],
      inspectSessionActivity: async () => 'waiting_input',
    }
    const service = new TaskflowDirectSessionService({
      config: { agents: {} },
      projectRoot: '/repo',
      sessions,
      sessionDiscovery,
    })

    const state = await service.start(startInput())
    expect(state.sessionId).toBe('provider-session-1')
    expect(state.capabilities).toEqual({ terminal: true, interactiveInput: true, interrupt: true, resume: true })
    expect(commands[0]).toContain('codex')
    expect(commands[0]).toContain("--model 'gpt-5.6-codex'")
    expect(commands[0]).toContain('Fix the failing test')
    expect(commands[0]).not.toContain('runtime.env')
    expect((await service.inspect(state.sessionId))?.active).toBe(true)
    expect((await service.inspect(state.sessionId))?.activity).toBe('waiting_input')

    await service.cancel(state.sessionId)
    expect((await service.inspect(state.sessionId))?.active).toBe(false)

    const resumed = await service.resume({ ...startInput(), sessionId: state.sessionId })
    expect(resumed.sessionId).toBe('provider-session-1')
    expect(commands[1]).toMatch(/codex .* resume 'provider-session-1'/)
    expect((await service.inspect(state.sessionId))?.active).toBe(true)
  })

  it('launches the Direct Session through its environment terminal transport', async () => {
    const { sessions, commands } = fakeSessions()
    const discovered: string[][] = [[], ['provider-session-1']]
    const sessionDiscovery: SessionDiscoveryGateway = {
      listSessionIds: async () => discovered.shift() ?? ['provider-session-1'],
    }
    const service = new TaskflowDirectSessionService({
      config: { agents: {} },
      projectRoot: '/repo',
      sessions,
      sessionDiscovery,
      environments: {
        workspace: () => ({ hostPath: '/repo/__worktrees/run', containerPath: '/workspaces/project' }),
        terminalCommand: (environmentId, command) => `inside:${environmentId}:${command}`,
      },
    })
    const input = startInput()
    input.run.environmentId = 'env_01'
    const state = await service.start(input)
    expect(commands[0]).toMatch(/^inside:env_01:/)
    expect(commands[0]).toContain('codex')
    expect(state.sessionId).toContain('pane:')
    expect(state.capabilities.resume).toBe(false)
  })

  it('pins a resumable Claude session id inside an environment', async () => {
    const { sessions, commands } = fakeSessions()
    const service = new TaskflowDirectSessionService({
      config: { agents: {} },
      projectRoot: '/repo',
      sessions,
      sessionDiscovery: { listSessionIds: async () => [] },
      environments: {
        workspace: () => ({ hostPath: '/repo/__worktrees/run', containerPath: '/workspaces/project' }),
        terminalCommand: (_environmentId, command) => command,
      },
    })
    const input = startInput()
    input.harness = 'claude'
    input.run.environmentId = 'env_01'
    const state = await service.start(input)
    expect(commands[0]).toContain(`--session-id '${state.sessionId}'`)
    expect(state.capabilities.resume).toBe(true)
  })

  it('maps custom agent workspace variables to the container workspace', async () => {
    const { sessions, commands } = fakeSessions()
    const service = new TaskflowDirectSessionService({
      config: {
        agents: {
          gemini: {
            label: 'Gemini',
            startCommand: 'gemini --cwd "${WORKTREE_PATH}" --repo "${REPO_PATH}"',
          },
        },
      },
      projectRoot: '/repo',
      sessions,
      sessionDiscovery: { listSessionIds: async () => [] },
      environments: {
        workspace: () => ({ hostPath: '/repo/__worktrees/run', containerPath: '/workspaces/project' }),
        terminalCommand: (_environmentId, command) => command,
      },
    })
    const input = startInput()
    input.harness = 'gemini'
    input.run.environmentId = 'env_01'
    await service.start(input)
    expect(commands[0]).toContain("export PORTTA_FLOW_AGENT_WORKTREE_PATH='/workspaces/project'")
    expect(commands[0]).toContain("export PORTTA_FLOW_AGENT_REPO_PATH='/workspaces/project'")
  })
})
