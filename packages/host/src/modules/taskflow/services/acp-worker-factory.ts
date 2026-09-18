import { setTimeout as delay } from 'node:timers/promises'
import {
  AgentError,
  AgentInterrupted,
  type AgentResult,
  type AgentSpec,
  type ProviderId,
  type Worker,
  type WorkerContext,
  type WorkerFactory,
} from '../workflows/index.ts'
import { type AcpProviderRegistry, availableProviders, type ResolvedAcpProvider } from './acp-providers.ts'
import type {
  AgentPermissionMode,
  StdioMcpServer,
  SupervisedOperationEvent,
  SupervisorExecution,
} from './agent-runtime-types.ts'
import type { AgentSupervisorPort } from './agent-supervisor.ts'

export interface AcpWorkerExecutionRoute {
  execution: SupervisorExecution
  cwd: string
}

function eventProgress(event: SupervisedOperationEvent, context: WorkerContext): void {
  if (event.type !== 'agent.update' || typeof event.payload !== 'object' || event.payload === null) return
  const payload = Array.isArray(event.payload) ? null : event.payload
  const update =
    payload && typeof payload.update === 'object' && payload.update !== null && !Array.isArray(payload.update)
      ? payload.update
      : null
  const content =
    update && typeof update.content === 'object' && update.content !== null && !Array.isArray(update.content)
      ? update.content
      : null
  if (update?.sessionUpdate === 'agent_message_chunk' && content?.type === 'text' && typeof content.text === 'string') {
    context.onProgress({ kind: 'text', text: content.text })
  }
  if (update?.sessionUpdate === 'agent_thought_chunk' && content?.type === 'text' && typeof content.text === 'string') {
    context.onProgress({ kind: 'reasoning', text: content.text })
  }
  if (update?.sessionUpdate === 'tool_call' && typeof update.title === 'string') {
    context.onProgress({
      kind: 'tool',
      ...(typeof update.toolCallId === 'string' ? { id: update.toolCallId } : {}),
      name: update.title,
      input: update.rawInput,
    })
  }
}

class AcpWorker implements Worker {
  readonly id: ProviderId
  private readonly launch: Pick<ResolvedAcpProvider, 'command' | 'args'>
  private readonly supervisor: AgentSupervisorPort
  private readonly runId: string
  private readonly permissionMode: AgentPermissionMode
  private readonly mcpServers: StdioMcpServer[]
  private readonly resolveExecution: (cwd: string) => AcpWorkerExecutionRoute
  constructor(
    provider: ResolvedAcpProvider,
    supervisor: AgentSupervisorPort,
    runId: string,
    permissionMode: AgentPermissionMode,
    mcpServers: StdioMcpServer[],
    resolveExecution: (cwd: string) => AcpWorkerExecutionRoute,
  ) {
    this.id = provider.id
    this.launch = { command: provider.command, args: provider.args }
    this.supervisor = supervisor
    this.runId = runId
    this.permissionMode = permissionMode
    this.mcpServers = mcpServers
    this.resolveExecution = resolveExecution
  }

  async runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult> {
    const launch = this.launch
    const operationId = `${this.runId}:${context.operationKey ?? crypto.randomUUID()}`
    const route = this.resolveExecution(spec.cwd)
    await this.supervisor.start({
      operationId,
      transport: 'acp',
      provider: this.id,
      command: launch.command,
      args: launch.args,
      cwd: route.cwd,
      env: spec.launcherEnv,
      prompt: spec.prompt,
      permissionMode: this.permissionMode,
      mcpServers: this.mcpServers,
      execution: route.execution,
    })
    let cursor = 0
    while (true) {
      if (context.signal.aborted) {
        if (context.signal.reason !== 'taskflow-detach') await this.supervisor.cancel(operationId)
        throw new AgentInterrupted()
      }
      for (const event of await this.supervisor.events(operationId, cursor)) {
        cursor = event.sequence
        eventProgress(event, context)
      }
      const operation = await this.supervisor.inspect(operationId)
      if (operation.status === 'completed') {
        const result =
          typeof operation.result === 'object' && operation.result !== null && !Array.isArray(operation.result)
            ? operation.result
            : null
        return {
          text: typeof result?.text === 'string' ? result.text : '',
          status: 'completed',
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        }
      }
      if (operation.status === 'cancelled') throw new AgentInterrupted()
      if (operation.status === 'failed' || operation.status === 'recovery_required') {
        throw new Error(operation.error ?? `ACP ${this.id} operation failed`)
      }
      await delay(50, undefined, { signal: context.signal }).catch((): void => {})
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

export class AcpWorkerFactory implements WorkerFactory {
  private readonly workers = new Map<ProviderId, Worker>()

  private readonly supervisor: AgentSupervisorPort
  private readonly providers: AcpProviderRegistry
  private readonly runId: string
  private readonly permissionMode: AgentPermissionMode
  private readonly mcpServers: StdioMcpServer[]
  private readonly resolveExecution: (cwd: string) => AcpWorkerExecutionRoute
  private readonly onShutdown?: () => void
  constructor(
    supervisor: AgentSupervisorPort,
    providers: AcpProviderRegistry,
    runId: string,
    permissionMode: AgentPermissionMode,
    mcpServers: StdioMcpServer[],
    resolveExecution: (cwd: string) => AcpWorkerExecutionRoute,
    onShutdown?: () => void,
  ) {
    this.supervisor = supervisor
    this.providers = providers
    this.runId = runId
    this.permissionMode = permissionMode
    this.mcpServers = mcpServers
    this.resolveExecution = resolveExecution
    this.onShutdown = onShutdown
  }

  get(id: ProviderId): Worker {
    const existing = this.workers.get(id)
    if (existing) return existing
    const provider = this.providers.get(id)
    if (!provider) {
      throw new AgentError({
        provider: id,
        code: 'unknown_provider',
        message: `unknown provider "${id}" — available: ${availableProviders(this.providers)}`,
      })
    }
    const worker = new AcpWorker(
      provider,
      this.supervisor,
      this.runId,
      this.permissionMode,
      this.mcpServers,
      this.resolveExecution,
    )
    this.workers.set(id, worker)
    return worker
  }

  shutdownAll(): Promise<void> {
    this.workers.clear()
    this.onShutdown?.()
    return Promise.resolve()
  }
}
