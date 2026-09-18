import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createConnection, createServer, type Server } from 'node:net'
import type { AgentSupervisor } from './agent-supervisor.ts'
import {
  AGENT_SUPERVISOR_PROTOCOL_VERSION,
  type AgentSupervisorRequest,
  type AgentSupervisorResponse,
} from './agent-supervisor-protocol.ts'

function encode(response: AgentSupervisorResponse): string {
  return `${JSON.stringify(response)}\n`
}

async function dispatch(
  supervisor: AgentSupervisor,
  request: AgentSupervisorRequest,
): Promise<AgentSupervisorResponse> {
  if (request.version !== AGENT_SUPERVISOR_PROTOCOL_VERSION) {
    return { id: request.id, version: 1, error: `Unsupported supervisor protocol: ${request.version}` }
  }
  try {
    const result =
      request.method === 'start'
        ? await supervisor.start(request.params)
        : request.method === 'inspect'
          ? await supervisor.inspect(request.params.operationId)
          : request.method === 'events'
            ? await supervisor.events(request.params.operationId, request.params.after)
            : request.method === 'cancel'
              ? await supervisor.cancel(request.params.operationId)
              : request.method === 'respondPermission'
                ? await supervisor.respondPermission(
                    request.params.operationId,
                    request.params.requestId,
                    request.params.optionId,
                  )
                : request.method === 'list'
                  ? await supervisor.list(request.params.prefix)
                  : { active: await supervisor.hasActiveOperations() }
    return { id: request.id, version: 1, result }
  } catch (error: unknown) {
    return { id: request.id, version: 1, error: error instanceof Error ? error.message : String(error) }
  }
}

function socketIsLive(path: string): Promise<boolean> {
  return new Promise((resolve): void => {
    const socket = createConnection(path)
    socket.once('connect', (): void => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (): void => resolve(false))
  })
}

export async function startAgentSupervisorServer(socketPath: string, supervisor: AgentSupervisor): Promise<Server> {
  if (existsSync(socketPath)) {
    if (await socketIsLive(socketPath))
      throw new Error(`A Taskflow runtime supervisor is already listening: ${socketPath}`)
    unlinkSync(socketPath)
  }
  const server = createServer((socket): void => {
    let data = ''
    let dispatched = false
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string): void => {
      data += chunk
      if (dispatched || !data.includes('\n')) return
      dispatched = true
      const line = data.slice(0, data.indexOf('\n')).trim()
      if (!line) {
        socket.end()
        return
      }
      try {
        const request = JSON.parse(line) as AgentSupervisorRequest
        void dispatch(supervisor, request).then((response): void => {
          socket.end(encode(response))
        })
      } catch (error) {
        socket.end(
          encode({
            id: 'invalid-request',
            version: 1,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    })
  })
  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject)
    server.listen(socketPath, (): void => {
      server.off('error', reject)
      chmodSync(socketPath, 0o600)
      supervisor.recoverInterrupted()
      resolve()
    })
  })
  server.once('close', (): void => {
    if (existsSync(socketPath)) unlinkSync(socketPath)
  })
  return server
}
