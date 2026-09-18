import { createServer, type Server, type Socket } from 'node:net'
import type { Endpoint, EnvironmentHandle, ServicePort } from 'portta-core/taskflow'
import type { ExecutionTransport } from '../adapters/environment-provider.ts'

const CONNECTOR_SOURCE = [
  'const net = require("node:net");',
  'const socket = net.connect(Number(process.argv[2]), process.argv[1]);',
  'process.stdin.pipe(socket);',
  'socket.pipe(process.stdout);',
  'socket.on("error", (error) => { console.error(error.message); process.exitCode = 1; });',
].join('')

interface ActiveForward {
  server: Server
  sockets: Set<Socket>
  url: string
}

export interface PublishForwardInput {
  endpointId: string
  serviceId: string
  targetHost: string
  port: ServicePort
  environment: EnvironmentHandle
  transport: ExecutionTransport
}

export class LocalForwardProvider {
  private readonly active = new Map<string, ActiveForward>()

  has(endpointId: string): boolean {
    return this.active.has(endpointId)
  }

  url(endpointId: string): string | null {
    return this.active.get(endpointId)?.url ?? null
  }

  async publish(input: PublishForwardInput): Promise<Endpoint> {
    await this.revoke(input.endpointId)
    const sockets = new Set<Socket>()
    const server = createServer((socket): void => {
      sockets.add(socket)
      const command = input.transport.spawn(input.environment, {
        argv: ['node', '-e', CONNECTOR_SOURCE, input.targetHost, String(input.port.containerPort)],
        cwd: 'workspace',
        stdin: 'pipe',
      })
      socket.on('data', (chunk: Buffer): void => {
        void command.write(chunk)
      })
      socket.on('end', (): void => command.closeStdin())
      socket.on('close', (): void => {
        sockets.delete(socket)
        void command.kill()
      })
      socket.on('error', (): void => {
        void command.kill()
      })
      void (async (): Promise<void> => {
        const reader = command.stdout.getReader()
        try {
          for (;;) {
            const next = await reader.read()
            if (next.done) break
            if (!socket.destroyed) socket.write(next.value)
          }
        } finally {
          reader.releaseLock()
        }
      })()
      void command.exited.then((exit): void => {
        if (!socket.destroyed) {
          if (exit.code === 0) socket.end()
          else socket.destroy(new Error(`Environment forward exited with code ${exit.code ?? 'signal'}`))
        }
      })
    })
    await new Promise<void>((resolve, reject): void => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', (): void => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('Local forward did not bind a TCP port')
    const scheme = input.port.protocol === 'http' ? 'http' : input.port.protocol === 'https' ? 'https' : 'tcp'
    const url = `${scheme}://127.0.0.1:${address.port}`
    this.active.set(input.endpointId, { server, sockets, url })
    return {
      id: input.endpointId,
      serviceId: input.serviceId,
      url,
      audiences: ['taskflow', 'user'],
      visibility: 'private',
      accessMode: 'localhost',
      executionLocus: 'host',
      stable: false,
      provider: 'local-forward',
      providerResourceId: input.endpointId,
    }
  }

  async revoke(endpointId: string): Promise<void> {
    const active = this.active.get(endpointId)
    if (!active) return
    this.active.delete(endpointId)
    for (const socket of active.sockets) socket.destroy()
    await new Promise<void>((resolve): void => {
      active.server.close((): void => resolve())
    })
  }

  async close(): Promise<void> {
    await Promise.all([...this.active.keys()].map((endpointId) => this.revoke(endpointId)))
  }
}
