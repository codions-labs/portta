import type { EnvironmentHandle } from 'portta-core/taskflow'
import type { ExecutionTransport } from '../adapters/environment-provider.ts'
import { buildProjectSessionName, buildWorktreeWindowName, type SessionGateway } from '../adapters/session-gateway.ts'
import type { AgentLaunchSpec } from './agent-runtime-types.ts'
import type { AgentSupervisorPort } from './agent-supervisor.ts'
import type {
  DirectSessionPort,
  DirectSessionResumeInput,
  DirectSessionStartInput,
  DirectSessionState,
} from './direct-session-port.ts'

export interface AcpExecutionRoute {
  handle: EnvironmentHandle
  transport: ExecutionTransport
  cwd: string
}

export interface AcpDirectSessionServiceDependencies {
  supervisor: AgentSupervisorPort
  projectRoot: string
  sessions: SessionGateway
  resolveRoute(environmentId: string | null, workspacePath: string): AcpExecutionRoute
}

const launchByHarness: Record<string, { command: string; args: string[] }> = {
  codex: { command: 'codex-acp', args: [] },
  claude: { command: 'claude-agent-acp', args: [] },
  opencode: { command: 'opencode', args: ['acp'] },
  pi: { command: 'pi-acp', args: [] },
}

function launchFor(harness: string): { command: string; args: string[] } {
  const launch = launchByHarness[harness]
  if (!launch) throw new Error(`No ACP launch adapter is configured for harness: ${harness}`)
  return launch
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function invocationCommand(invocation: { command: string; args: string[] }): string {
  return [invocation.command, ...invocation.args].map(quoteShell).join(' ')
}

export function acpDirectSessionState(
  operation: Awaited<ReturnType<AgentSupervisorPort['inspect']>>,
): DirectSessionState {
  const negotiated = operation.capabilities
  const active =
    operation.status === 'running' || operation.status === 'starting' || operation.status === 'waiting_input'
  return {
    sessionId: operation.id,
    checkpoint: operation.sessionId ? { acpSessionId: operation.sessionId } : null,
    capabilities: {
      terminal: true,
      interactiveInput: operation.status !== 'running' && operation.status !== 'starting',
      interrupt:
        operation.status === 'running' || operation.status === 'starting' || operation.status === 'waiting_input',
      resume: negotiated?.resumeSession === true || negotiated?.loadSession === true,
    },
    active,
    activity: operation.status === 'waiting_input' ? 'waiting_input' : 'running',
    ...(!active
      ? {
          terminal: {
            status:
              operation.status === 'starting' || operation.status === 'running' || operation.status === 'waiting_input'
                ? 'recovery_required'
                : operation.status,
            result: operation.result,
            error: operation.error,
          },
        }
      : {}),
  }
}

export class AcpDirectSessionService implements DirectSessionPort {
  private readonly deps: AcpDirectSessionServiceDependencies
  constructor(deps: AcpDirectSessionServiceDependencies) {
    this.deps = deps
  }

  start(input: DirectSessionStartInput): Promise<DirectSessionState> {
    const operationId = `${input.run.id}:direct:root:1`
    return this.startOperation(operationId, input)
  }

  cancel(sessionId: string): Promise<void> {
    return this.deps.supervisor.cancel(sessionId).then((): void => {})
  }

  async resume(input: DirectSessionResumeInput): Promise<DirectSessionState> {
    const previous = await this.deps.supervisor.inspect(input.sessionId)
    if (!previous.sessionId) throw new Error('ACP session id is not available for resume')
    const operationId = `${input.run.id}:direct:resume:${input.run.updatedAt}`
    return this.startOperation(operationId, input, previous.sessionId)
  }

  async inspect(sessionId: string): Promise<DirectSessionState | null> {
    try {
      return acpDirectSessionState(await this.deps.supervisor.inspect(sessionId))
    } catch {
      return null
    }
  }

  events(sessionId: string, after = 0) {
    return this.deps.supervisor.events(sessionId, after)
  }

  respondPermission(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
    return this.deps.supervisor.respondPermission(sessionId, requestId, optionId).then((): void => {})
  }

  private async startOperation(
    operationId: string,
    input: DirectSessionStartInput,
    sessionId?: string,
  ): Promise<DirectSessionState> {
    const route = this.deps.resolveRoute(input.run.environmentId, input.workspace.path)
    const humanTerminal = this.ensureHumanTerminal(input, route).catch(() => undefined)
    const launch = launchFor(input.harness)
    const spec: AgentLaunchSpec = {
      operationId,
      transport: 'acp',
      provider: input.harness,
      command: launch.command,
      args: launch.args,
      cwd: route.cwd,
      prompt: typeof input.run.input === 'string' ? input.run.input : JSON.stringify(input.run.input),
      permissionMode: input.permissionMode,
      mcpServers: input.mcpServers,
      execution: {
        provider: route.handle.provider,
        hostPath: route.handle.workspace.hostPath,
        containerPath: route.handle.workspace.containerPath ?? null,
        containerRef:
          typeof route.handle.providerRef.value.containerId === 'string'
            ? route.handle.providerRef.value.containerId
            : typeof route.handle.providerRef.value.containerName === 'string'
              ? route.handle.providerRef.value.containerName
              : null,
      },
      ...(sessionId ? { sessionId } : {}),
    }
    const started = await this.deps.supervisor.start(spec)
    await humanTerminal
    return acpDirectSessionState(started.operation)
  }

  private async ensureHumanTerminal(input: DirectSessionStartInput, route: AcpExecutionRoute): Promise<void> {
    const sessionName = buildProjectSessionName(this.deps.projectRoot)
    const windowName = buildWorktreeWindowName(input.workspace.branch)
    if (await this.deps.sessions.hasWindow(sessionName, windowName)) return
    const invocation = route.transport.terminalInvocation(route.handle)
    await this.deps.sessions.ensureServer()
    await this.deps.sessions.ensureSession(sessionName, input.workspace.path)
    await this.deps.sessions.createWindow({
      sessionName,
      windowName,
      cwd: invocation.cwd,
      command: invocationCommand(invocation),
    })
  }
}

export class RoutingDirectSessionService implements DirectSessionPort {
  private readonly native: DirectSessionPort
  private readonly acp: DirectSessionPort
  constructor(native: DirectSessionPort, acp: DirectSessionPort) {
    this.native = native
    this.acp = acp
  }

  start(input: DirectSessionStartInput): Promise<DirectSessionState> {
    return (input.transport === 'acp' ? this.acp : this.native).start(input)
  }

  cancel(sessionId: string): Promise<void> {
    return this.acp
      .inspect(sessionId)
      .then((state) => (state ? this.acp.cancel(sessionId) : this.native.cancel(sessionId)))
  }

  resume(input: DirectSessionResumeInput): Promise<DirectSessionState> {
    return (input.transport === 'acp' ? this.acp : this.native).resume(input)
  }

  async inspect(sessionId: string): Promise<DirectSessionState | null> {
    return (await this.acp.inspect(sessionId)) ?? this.native.inspect(sessionId)
  }

  async events(sessionId: string, after = 0) {
    return (await this.acp.inspect(sessionId)) ? (this.acp.events?.(sessionId, after) ?? []) : []
  }

  async respondPermission(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
    if (!(await this.acp.inspect(sessionId))) throw new Error('ACP session was not found')
    await this.acp.respondPermission?.(sessionId, requestId, optionId)
  }
}
