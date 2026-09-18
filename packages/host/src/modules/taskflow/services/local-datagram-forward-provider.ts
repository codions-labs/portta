import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import type { Endpoint, EnvironmentHandle, ServicePort } from 'portta-core/taskflow'
import type { ExecutionTransport } from '../adapters/environment-provider.ts'

const DATAGRAM_CONNECTOR_SOURCE = [
  'const dgram = require("node:dgram");',
  'const chunks = [];',
  'process.stdin.on("data", chunk => chunks.push(chunk));',
  'process.stdin.on("end", () => {',
  'const socket = dgram.createSocket("udp4");',
  'socket.once("message", message => { process.stdout.write(message); socket.close(); });',
  'socket.once("error", error => { console.error(error.message); process.exitCode = 1; socket.close(); });',
  'socket.send(Buffer.concat(chunks), Number(process.argv[2]), process.argv[1]);',
  'setTimeout(() => { process.exitCode = 1; socket.close(); }, 5000).unref();',
  '});',
].join('')

interface ActiveDatagramForward {
  socket: Socket
  commands: Set<ReturnType<ExecutionTransport['spawn']>>
  url: string
}

export interface PublishDatagramForwardInput {
  endpointId: string
  serviceId: string
  targetHost: string
  port: ServicePort
  environment: EnvironmentHandle
  transport: ExecutionTransport
}

export class LocalDatagramForwardProvider {
  private readonly active = new Map<string, ActiveDatagramForward>()

  has(endpointId: string): boolean {
    return this.active.has(endpointId)
  }

  url(endpointId: string): string | null {
    return this.active.get(endpointId)?.url ?? null
  }

  async publish(input: PublishDatagramForwardInput): Promise<Endpoint> {
    await this.revoke(input.endpointId)
    const socket = createSocket('udp4')
    const commands = new Set<ReturnType<ExecutionTransport['spawn']>>()
    socket.on('message', (message, remote): void => {
      const command = input.transport.spawn(input.environment, {
        argv: ['node', '-e', DATAGRAM_CONNECTOR_SOURCE, input.targetHost, String(input.port.containerPort)],
        cwd: 'workspace',
        stdin: 'pipe',
        timeoutMs: 6_000,
      })
      commands.add(command)
      void command.write(message).then(() => command.closeStdin())
      void this.pipeResponse(command.stdout, socket, remote)
      void command.exited.finally(() => commands.delete(command))
    })
    await new Promise<void>((resolve, reject): void => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', (): void => {
        socket.off('error', reject)
        resolve()
      })
    })
    const address = socket.address()
    const url = `udp://127.0.0.1:${address.port}`
    this.active.set(input.endpointId, { socket, commands, url })
    return {
      id: input.endpointId,
      serviceId: input.serviceId,
      url,
      audiences: ['taskflow', 'user'],
      visibility: 'private',
      accessMode: 'localhost',
      executionLocus: 'host',
      stable: false,
      provider: 'local-udp-forward',
      providerResourceId: input.endpointId,
    }
  }

  async revoke(endpointId: string): Promise<void> {
    const active = this.active.get(endpointId)
    if (!active) return
    this.active.delete(endpointId)
    await Promise.all(Array.from(active.commands, (command) => command.kill()))
    await new Promise<void>((resolve): void => {
      active.socket.close(() => resolve())
    })
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.active.keys(), (endpointId) => this.revoke(endpointId)))
  }

  private async pipeResponse(stream: ReadableStream<Uint8Array>, socket: Socket, remote: RemoteInfo): Promise<void> {
    const reader = stream.getReader()
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        socket.send(next.value, remote.port, remote.address)
      }
    } finally {
      reader.releaseLock()
    }
  }
}
