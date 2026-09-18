import { createConnection, createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { HostEnvironmentProvider } from '../adapters/host-environment.ts'
import { LocalForwardProvider } from '../services/local-forward-provider.ts'

describe('LocalForwardProvider', () => {
  it('bridges a loopback TCP port through the environment transport', async () => {
    const target = createServer((socket): void => {
      socket.on('data', (data): void => {
        socket.write(Buffer.from(data.toString().toUpperCase()))
      })
    })
    await new Promise<void>((resolve): void => {
      target.listen(0, '127.0.0.1', resolve)
    })
    const address = target.address()
    if (typeof address !== 'object' || address === null) throw new Error('target did not bind')
    const transport = new HostEnvironmentProvider()
    const environment = await transport.start(
      await transport.resolve({
        workspacePath: process.cwd(),
        projectPath: process.cwd(),
        scope: { installationId: 'local', projectId: 'project', workspaceId: 'workspace' },
      }),
      { installationId: 'local', projectId: 'project', workspaceId: 'workspace' },
    )
    const forwards = new LocalForwardProvider()
    const endpoint = await forwards.publish({
      endpointId: 'endpoint_test',
      serviceId: 'service_test',
      targetHost: '127.0.0.1',
      port: { containerPort: address.port, protocol: 'tcp' },
      environment,
      transport,
    })
    const forwardPort = Number(new URL(endpoint.url).port)
    const response = await new Promise<string>((resolve, reject): void => {
      const socket = createConnection(forwardPort, '127.0.0.1', (): void => {
        socket.write('hello')
      })
      socket.once('data', (data): void => {
        resolve(data.toString())
        socket.end()
      })
      socket.once('error', reject)
    })
    expect(response).toBe('HELLO')
    expect(endpoint).toMatchObject({ accessMode: 'localhost', stable: false, provider: 'local-forward' })
    await forwards.close()
    await new Promise<void>((resolve): void => {
      target.close((): void => resolve())
    })
  })
})
