import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentLaunchSpec, SupervisedOperation, SupervisedOperationEvent } from './agent-runtime-types.ts'
import type { AgentSupervisorPort, AgentSupervisorStartResult } from './agent-supervisor.ts'
import {
  AGENT_SUPERVISOR_PROTOCOL_VERSION,
  type AgentSupervisorRequest,
  type AgentSupervisorResponse,
} from './agent-supervisor-protocol.ts'

export interface AgentSupervisorClientDependencies {
  socketPath: string
  startDaemon?: () => void
}

function responseResult(response: AgentSupervisorResponse): AgentSupervisorResponse & { result: unknown } {
  if ('error' in response) throw new Error(response.error)
  return response
}

export class AgentSupervisorClient implements AgentSupervisorPort {
  private starting = false

  private readonly deps: AgentSupervisorClientDependencies
  constructor(deps: AgentSupervisorClientDependencies) {
    this.deps = deps
  }

  start(spec: AgentLaunchSpec): Promise<AgentSupervisorStartResult> {
    return this.request({ method: 'start', params: spec }).then((result) => result as AgentSupervisorStartResult)
  }

  inspect(operationId: string): Promise<SupervisedOperation> {
    return this.request({ method: 'inspect', params: { operationId } }).then((result) => result as SupervisedOperation)
  }

  events(operationId: string, after = 0): Promise<SupervisedOperationEvent[]> {
    return this.request({ method: 'events', params: { operationId, after } }).then(
      (result) => result as SupervisedOperationEvent[],
    )
  }

  cancel(operationId: string): Promise<SupervisedOperation> {
    return this.request({ method: 'cancel', params: { operationId } }).then((result) => result as SupervisedOperation)
  }

  respondPermission(operationId: string, requestId: string, optionId: string | null): Promise<SupervisedOperation> {
    return this.request({ method: 'respondPermission', params: { operationId, requestId, optionId } }).then(
      (result) => result as SupervisedOperation,
    )
  }

  hasActiveOperations(): Promise<boolean> {
    return this.request({ method: 'status', params: {} }).then((result) => (result as { active: boolean }).active)
  }

  list(prefix?: string): Promise<SupervisedOperation[]> {
    return this.request({ method: 'list', params: { ...(prefix ? { prefix } : {}) } }).then(
      (result) => result as SupervisedOperation[],
    )
  }

  private async request(request: Omit<AgentSupervisorRequest, 'id' | 'version'>): Promise<unknown> {
    const message = {
      ...request,
      id: crypto.randomUUID(),
      version: AGENT_SUPERVISOR_PROTOCOL_VERSION,
    } as AgentSupervisorRequest
    for (let attempt = 0; attempt < 41; attempt += 1) {
      try {
        return await this.send(message)
      } catch (error: unknown) {
        const unavailable =
          error instanceof Error &&
          (error.message.includes('ENOENT') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('socket closed'))
        if (!unavailable || !this.deps.startDaemon) throw error
        if (!this.starting) {
          this.starting = true
          this.deps.startDaemon()
        }
        await delay(50)
      }
    }
    this.starting = false
    throw new Error('Taskflow runtime supervisor did not become available')
  }

  private send(request: AgentSupervisorRequest): Promise<unknown> {
    return new Promise((resolve, reject): void => {
      const socket = createConnection(this.deps.socketPath)
      let data = ''
      socket.setEncoding('utf8')
      socket.on('connect', (): void => {
        this.starting = false
        socket.write(`${JSON.stringify(request)}\n`)
      })
      socket.on('data', (chunk: string): void => {
        data += chunk
      })
      socket.on('error', reject)
      socket.on('close', (): void => {
        const line = data.trim()
        if (!line) {
          reject(new Error('Supervisor socket closed without a response'))
          return
        }
        try {
          const response = responseResult(JSON.parse(line) as AgentSupervisorResponse)
          resolve(response.result)
        } catch (error: unknown) {
          reject(error)
        }
      })
    })
  }
}
