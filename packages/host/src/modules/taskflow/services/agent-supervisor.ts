import { setTimeout as delay } from 'node:timers/promises'
import type { AgentSupervisorStore } from '../adapters/agent-supervisor-store.ts'
import { type AcpAgentProcess, runAcpAgentSession, selectPermissionOption } from './acp-agent-session.ts'
import type { AgentLaunchSpec, SupervisedOperation, SupervisedOperationEvent } from './agent-runtime-types.ts'

export interface AgentSupervisorLaunch {
  process: AcpAgentProcess
  spawnTerminal: Parameters<typeof runAcpAgentSession>[0]['spawnTerminal']
}

export interface AgentSupervisorDependencies {
  store: AgentSupervisorStore
  launch(spec: AgentLaunchSpec): AgentSupervisorLaunch
  now?: () => Date
}

export interface AgentSupervisorStartResult {
  operation: SupervisedOperation
  replayed: boolean
}

export interface AgentSupervisorPort {
  start(spec: AgentLaunchSpec): Promise<AgentSupervisorStartResult>
  inspect(operationId: string): Promise<SupervisedOperation>
  events(operationId: string, after?: number): Promise<SupervisedOperationEvent[]>
  cancel(operationId: string): Promise<SupervisedOperation>
  respondPermission(operationId: string, requestId: string, optionId: string | null): Promise<SupervisedOperation>
  list(prefix?: string): Promise<SupervisedOperation[]>
  hasActiveOperations(): Promise<boolean>
}

interface PendingPermission {
  requestId: string
  options: Array<{ optionId: string; kind: string }>
  resolve(optionId: string | null): void
}

interface ActiveOperation {
  process: AcpAgentProcess
  controller: AbortController
}

export class AgentSupervisor implements AgentSupervisorPort {
  private readonly active = new Map<string, ActiveOperation>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly now: () => Date

  private readonly deps: AgentSupervisorDependencies
  constructor(deps: AgentSupervisorDependencies) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
  }

  recoverInterrupted(): SupervisedOperation[] {
    return this.deps.store.listActive().map((operation) =>
      this.deps.store.update(operation.id, {
        status: 'recovery_required',
        error: 'The runtime supervisor restarted while this operation was active',
        completedAt: this.now().toISOString(),
      }),
    )
  }

  async start(spec: AgentLaunchSpec): Promise<AgentSupervisorStartResult> {
    const created = this.deps.store.create(spec)
    if (created.replayed) return created
    if (spec.transport !== 'acp') {
      return {
        operation: this.deps.store.update(spec.operationId, {
          status: 'failed',
          error: 'Native operations must use the native bridge',
          completedAt: this.now().toISOString(),
        }),
        replayed: false,
      }
    }
    let launched: AgentSupervisorLaunch
    try {
      launched = this.deps.launch(spec)
    } catch (error) {
      this.deps.store.update(spec.operationId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: this.now().toISOString(),
      })
      throw error
    }
    const controller = new AbortController()
    this.active.set(spec.operationId, { process: launched.process, controller })
    this.deps.store.update(spec.operationId, { status: 'starting', pid: launched.process.pid ?? null })
    void runAcpAgentSession({
      process: launched.process,
      cwd: spec.cwd,
      prompt: spec.prompt,
      sessionId: spec.sessionId,
      permissionMode: spec.permissionMode,
      mcpServers: spec.mcpServers,
      signal: controller.signal,
      spawnTerminal: launched.spawnTerminal,
      onReady: (sessionId, capabilities): void => {
        this.deps.store.update(spec.operationId, { status: 'running', sessionId, capabilities })
        this.deps.store.appendEvent(
          spec.operationId,
          'agent.ready',
          JSON.parse(JSON.stringify({ sessionId, capabilities })),
        )
      },
      onEvent: (type, payload): void => {
        this.deps.store.appendEvent(spec.operationId, type, payload)
      },
      requestPermission: (toolKind, options, request): Promise<string | null> => {
        const selected = selectPermissionOption(spec.permissionMode, toolKind, options)
        if (spec.permissionMode !== 'interactive') {
          this.deps.store.appendEvent(spec.operationId, 'agent.permission.resolved', {
            mode: spec.permissionMode,
            optionId: selected,
            request: JSON.parse(JSON.stringify(request)),
          })
          return Promise.resolve(selected)
        }
        const requestId = crypto.randomUUID()
        this.deps.store.appendEvent(spec.operationId, 'agent.permission', {
          requestId,
          request: JSON.parse(JSON.stringify(request)),
        })
        this.deps.store.update(spec.operationId, { status: 'waiting_input' })
        return new Promise((resolve): void => {
          this.pendingPermissions.set(spec.operationId, { requestId, options, resolve })
        })
      },
    })
      .then((result): void => {
        if (this.deps.store.get(spec.operationId)?.status === 'cancelled') return
        this.deps.store.appendEvent(spec.operationId, 'agent.completed', JSON.parse(JSON.stringify(result)))
        this.deps.store.update(spec.operationId, {
          status: result.stopReason === 'cancelled' ? 'cancelled' : 'completed',
          sessionId: result.sessionId,
          result: { text: result.text, stopReason: result.stopReason },
          exitCode: 0,
          completedAt: this.now().toISOString(),
        })
      })
      .catch((error: unknown): void => {
        if (this.deps.store.get(spec.operationId)?.status === 'cancelled') return
        this.deps.store.update(spec.operationId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          completedAt: this.now().toISOString(),
        })
      })
      .finally((): void => {
        this.active.delete(spec.operationId)
        this.pendingPermissions.delete(spec.operationId)
      })
    return { operation: await this.inspect(spec.operationId), replayed: false }
  }

  inspect(operationId: string): Promise<SupervisedOperation> {
    const operation = this.deps.store.get(operationId)
    if (!operation) throw new Error(`Supervisor operation was not found: ${operationId}`)
    return Promise.resolve(operation)
  }

  events(operationId: string, after = 0): Promise<SupervisedOperationEvent[]> {
    return Promise.resolve(this.deps.store.listEvents(operationId, after))
  }

  async cancel(operationId: string): Promise<SupervisedOperation> {
    const operation = await this.inspect(operationId)
    if (operation.status !== 'starting' && operation.status !== 'running' && operation.status !== 'waiting_input') {
      return operation
    }
    const active = this.active.get(operationId)
    if (!active) {
      return this.deps.store.update(operationId, {
        status: 'recovery_required',
        error: 'The operation process is no longer attached to this supervisor',
        completedAt: this.now().toISOString(),
      })
    }
    this.pendingPermissions.get(operationId)?.resolve(null)
    this.pendingPermissions.delete(operationId)
    active.controller.abort()
    let exited = await Promise.race([active.process.exited.then(() => true), delay(2_000).then(() => false)])
    if (!exited) {
      await active.process.interrupt()
      exited = await Promise.race([active.process.exited.then(() => true), delay(1_000).then(() => false)])
    }
    if (!exited) await active.process.kill()
    return this.deps.store.update(operationId, {
      status: 'cancelled',
      completedAt: this.now().toISOString(),
    })
  }

  async respondPermission(
    operationId: string,
    requestId: string,
    optionId: string | null,
  ): Promise<SupervisedOperation> {
    const operation = await this.inspect(operationId)
    const pending = this.pendingPermissions.get(operationId)
    if (!pending || pending.requestId !== requestId) throw new Error('ACP permission request is no longer pending')
    if (optionId !== null && !pending.options.some((option) => option.optionId === optionId)) {
      throw new Error(`ACP permission option is invalid: ${optionId}`)
    }
    this.pendingPermissions.delete(operationId)
    this.deps.store.appendEvent(operationId, 'agent.permission.resolved', { requestId, optionId })
    const updated = this.deps.store.update(operationId, { status: 'running' })
    pending.resolve(optionId)
    return operation.status === 'waiting_input' ? updated : operation
  }

  hasActiveOperations(): Promise<boolean> {
    return Promise.resolve(this.deps.store.listActive().length > 0)
  }

  list(prefix?: string): Promise<SupervisedOperation[]> {
    return Promise.resolve(this.deps.store.list(prefix))
  }
}
