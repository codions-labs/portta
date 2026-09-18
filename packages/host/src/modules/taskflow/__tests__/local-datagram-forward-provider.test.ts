import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { HostEnvironmentProvider } from '../adapters/host-environment.ts'
import { LocalDatagramForwardProvider } from '../services/local-datagram-forward-provider.ts'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

describe('LocalDatagramForwardProvider', () => {
  it('keeps UDP forwarding separate and loopback-only', async () => {
    const echo = createSocket('udp4')
    echo.on('message', (message, remote) => echo.send(message, remote.port, remote.address))
    await new Promise<void>((resolve, reject) => {
      echo.once('error', reject)
      echo.bind(0, '127.0.0.1', resolve)
    })
    closers.push(() => new Promise<void>((resolve) => echo.close(() => resolve())))
    const target = echo.address()
    const host = new HostEnvironmentProvider()
    const scope = { installationId: 'install', projectId: 'project', workspaceId: 'workspace' }
    const handle = await host.start(
      await host.resolve({ workspacePath: process.cwd(), projectPath: process.cwd(), scope }),
      scope,
    )
    const provider = new LocalDatagramForwardProvider()
    closers.push(() => provider.close())
    const endpoint = await provider.publish({
      endpointId: 'endpoint_udp',
      serviceId: 'service_udp',
      targetHost: '127.0.0.1',
      port: { containerPort: target.port, protocol: 'udp' },
      environment: handle,
      transport: host,
    })
    const forwarded = new URL(endpoint.url.replace('udp:', 'http:'))
    const response = await new Promise<string>((resolveMessage, reject) => {
      const client = createSocket('udp4')
      client.once('message', (message) => {
        resolveMessage(message.toString())
        client.close()
      })
      client.once('error', reject)
      client.send('hello', Number(forwarded.port), forwarded.hostname)
    })

    expect(endpoint.provider).toBe('local-udp-forward')
    expect(endpoint.url).toMatch(/^udp:\/\/127\.0\.0\.1:/)
    expect(response).toBe('hello')
  })
})
