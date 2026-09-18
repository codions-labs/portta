import type { EnvironmentCommandHandle, EnvironmentHandle } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import type { ExecutionTransport } from '../adapters/environment-provider.ts'
import type { SessionGateway } from '../adapters/session-gateway.ts'
import { AcpDirectSessionService, acpDirectSessionState } from '../services/acp-direct-session-service.ts'
import type { AgentLaunchSpec, SupervisedOperation } from '../services/agent-runtime-types.ts'
import type { AgentSupervisorPort } from '../services/agent-supervisor.ts'
import type { DirectSessionStartInput } from '../services/direct-session-port.ts'

function operation(id: string): SupervisedOperation {
  return {
    id,
    status: 'running',
    transport: 'acp',
    provider: 'opencode',
    sessionId: 'acp-session-01',
    nativeSessionId: null,
    capabilities: null,
    pid: 42,
    result: null,
    error: null,
    exitCode: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    completedAt: null,
  }
}

function input(): DirectSessionStartInput {
  return {
    run: {
      id: 'run_01',
      projectId: 'project_01',
      mode: 'direct',
      input: 'Inspect the project',
      status: 'provisioning',
      workspacePolicy: 'run',
      workspaceStrategy: 'isolated_worktree',
      workspaceAccess: 'exclusive_write',
      workflowSnapshotId: null,
      environmentId: 'environment_01',
      workspaceId: 'workspace_01',
      worktreePath: '/host/worktree',
      canonicalWorkspacePath: '/host/worktree',
      branch: 'taskflow/run-01',
      baseBranch: 'main',
      baseCommit: 'abc',
      profile: 'default',
      engineKind: null,
      engineRunId: null,
      error: null,
      result: null,
      operationId: 'create_01',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
      issueRef: null,
    },
    workspace: {
      workspaceId: 'workspace_01',
      path: '/host/worktree',
      canonicalPath: '/host/worktree',
      branch: 'taskflow/run-01',
      baseBranch: 'main',
      baseCommit: 'abc',
      strategy: 'isolated_worktree',
      access: 'exclusive_write',
    },
    harness: 'opencode',
    provider: null,
    model: null,
    transport: 'acp',
    permissionMode: 'workspace',
    mcpServers: [],
  }
}

describe('AcpDirectSessionService', () => {
  it('maps durable completion and recovery states without claiming they are active', () => {
    expect(
      acpDirectSessionState({
        ...operation('run_01:direct:root:1'),
        status: 'completed',
        result: { text: 'done', stopReason: 'end_turn' },
        exitCode: 0,
      }),
    ).toMatchObject({
      active: false,
      checkpoint: { acpSessionId: 'acp-session-01' },
      terminal: { status: 'completed', result: { text: 'done', stopReason: 'end_turn' }, error: null },
    })
    expect(
      acpDirectSessionState({
        ...operation('run_01:direct:root:1'),
        status: 'recovery_required',
        error: 'supervisor restarted',
      }),
    ).toMatchObject({
      active: false,
      terminal: { status: 'recovery_required', error: 'supervisor restarted' },
    })
  })

  it('starts ACP in the selected container cwd and preserves a sibling tmux shell', async () => {
    let launch: AgentLaunchSpec | null = null
    const windows = new Set<string>()
    const commands: string[] = []
    const supervisor: AgentSupervisorPort = {
      start: async (spec) => {
        launch = spec
        return { operation: operation(spec.operationId), replayed: false }
      },
      inspect: async (id) => operation(id),
      events: async () => [],
      cancel: async (id) => operation(id),
      respondPermission: async (id) => operation(id),
      list: async () => [],
      hasActiveOperations: async () => false,
    }
    const sessions: SessionGateway = {
      ensureServer: async () => {},
      ensureSession: async () => {},
      hasWindow: async (session, window) => windows.has(`${session}:${window}`),
      killWindow: async () => {},
      createWindow: async ({ sessionName, windowName, command }) => {
        windows.add(`${sessionName}:${windowName}`)
        commands.push(command ?? '')
      },
      splitWindow: async () => {},
      runCommand: async () => {},
      selectPane: async () => {},
      focusWindow: async () => {},
      listWindows: async () => [],
      getPaneId: async () => 'pane-01',
      createParkedPane: async () => 'pane-02',
      swapPanes: async () => {},
      killPane: async () => {},
    }
    const handle: EnvironmentHandle = {
      id: 'environment_01',
      provider: 'compose',
      scope: { installationId: 'install', projectId: 'project_01', workspaceId: 'workspace_01' },
      status: 'ready',
      workspace: { hostPath: '/host/worktree', containerPath: '/workspace' },
      providerRef: { schemaVersion: 1, value: { containerId: 'container-01' } },
    }
    const transport: ExecutionTransport = {
      provider: 'compose',
      spawn: (): EnvironmentCommandHandle => {
        throw new Error('spawn was not expected')
      },
      terminalCommand: (_handle, command) => command,
      executableShim: (_handle, executable) => executable,
      terminalInvocation: () => ({
        command: 'docker',
        args: ['exec', '-it', 'container-01', '/bin/sh'],
        cwd: '/host/worktree',
      }),
      logsInvocation: () => ({ command: 'docker', args: ['logs', 'container-01'], cwd: '/host/worktree' }),
    }
    const service = new AcpDirectSessionService({
      supervisor,
      projectRoot: '/host/project',
      sessions,
      resolveRoute: () => ({ handle, transport, cwd: '/workspace' }),
    })

    await service.start(input())
    expect(commands).toEqual(["'docker' 'exec' '-it' 'container-01' '/bin/sh'"])
    expect(launch).toMatchObject({
      command: 'opencode',
      args: ['acp'],
      cwd: '/workspace',
      execution: { provider: 'compose', hostPath: '/host/worktree', containerRef: 'container-01' },
    })

    await service.start(input())
    expect(commands).toHaveLength(1)
  })

  it('does not make ACP startup depend on the human multiplexer', async () => {
    let started = false
    const supervisor: AgentSupervisorPort = {
      start: async (spec) => {
        started = true
        return { operation: operation(spec.operationId), replayed: false }
      },
      inspect: async (id) => operation(id),
      events: async () => [],
      cancel: async (id) => operation(id),
      respondPermission: async (id) => operation(id),
      list: async () => [],
      hasActiveOperations: async () => false,
    }
    const sessions = {
      ensureServer: async () => {
        throw new Error('tmux unavailable')
      },
      ensureSession: async () => {},
      hasWindow: async () => false,
      killWindow: async () => {},
      createWindow: async () => {},
      splitWindow: async () => {},
      runCommand: async () => {},
      selectPane: async () => {},
      focusWindow: async () => {},
      listWindows: async () => [],
      getPaneId: async () => 'pane-01',
      createParkedPane: async () => 'pane-02',
      swapPanes: async () => {},
      killPane: async () => {},
    } satisfies SessionGateway
    const handle: EnvironmentHandle = {
      id: 'environment_01',
      provider: 'host',
      scope: { installationId: 'install', projectId: 'project_01', workspaceId: 'workspace_01' },
      status: 'ready',
      workspace: { hostPath: '/host/worktree' },
      providerRef: { schemaVersion: 1, value: {} },
    }
    const transport = {
      provider: 'host',
      spawn: () => {
        throw new Error('spawn was not expected')
      },
      terminalCommand: (_handle: EnvironmentHandle, command: string) => command,
      executableShim: (_handle: EnvironmentHandle, executable: string) => executable,
      terminalInvocation: () => ({ command: '/bin/sh', args: [], cwd: '/host/worktree' }),
      logsInvocation: () => ({ command: 'tail', args: [], cwd: '/host/worktree' }),
    } satisfies ExecutionTransport
    const service = new AcpDirectSessionService({
      supervisor,
      projectRoot: '/host/project',
      sessions,
      resolveRoute: () => ({ handle, transport, cwd: '/host/worktree' }),
    })

    await expect(service.start(input())).resolves.toMatchObject({ active: true })
    expect(started).toBe(true)
  })
})
