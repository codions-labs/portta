import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { AccessView } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const access = vi.fn()
const openBridge = vi.fn()
const closeBridge = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    access: () => access(),
    openBridge: (...args: unknown[]) => openBridge(...args),
    closeBridge: (...args: unknown[]) => closeBridge(...args),
    serviceConnection: () =>
      Promise.resolve({
        project: 'alpha',
        service: 'postgres',
        kind: 'postgres',
        endpoints: [],
        credentials: {
          discovered: false,
          user: null,
          password: null,
          database: null,
          source: null,
          reason: 'not requested',
        },
      }),
  },
}))

const { AccessView: Access } = await import('../../app/(panel)/access/access-view.tsx')

const view: AccessView = {
  bridgeImageHint: 'alpine/socat:1.8.1.3',
  tcpRoutingEnabled: true,
  forwarders: [],
  bridges: [
    {
      id: 'ab12cd',
      containerId: 'bridge-1',
      project: 'alpha',
      service: 'postgres',
      targetPort: 5432,
      localPort: 55431,
      bindIp: '127.0.0.1',
      kind: 'postgres',
      network: 'alpha_default',
      createdAt: 1_700_000_000,
      expiresAt: null,
      state: 'running',
      connectionString: 'postgresql://<user>@127.0.0.1:55431/<database>',
    },
  ],
  services: [
    {
      containerId: 'a-postgres',
      project: 'alpha',
      service: 'postgres',
      image: 'postgres:18.6-alpine',
      kind: 'postgres',
      tech: { id: 'postgres', label: 'PostgreSQL' },
      state: 'running',
      health: 'healthy',
      ports: [5432],
      defaultPort: 5432,
      publishedPorts: [],
      privateNetworks: ['alpha_default'],
      bridge: null,
      forwarder: null,
      integrated: true,
      routing: 'starttls-sni',
      routed: true,
      gatewayAddress: 'storefront-postgres.localhost:5432',
      gatewayConnectionString: 'postgresql://<user>@storefront-postgres.localhost:5432/<database>?sslmode=require',
    },
    {
      containerId: 'a-redis',
      project: 'alpha',
      service: 'redis',
      image: 'redis:8.10.1-alpine',
      kind: 'redis',
      tech: { id: 'redis', label: 'Redis' },
      state: 'running',
      health: 'none',
      ports: [6379],
      defaultPort: 6379,
      publishedPorts: [],
      privateNetworks: ['alpha_default'],
      bridge: null,
      forwarder: null,
      integrated: true,
      routing: 'tls-sni',
      routed: false,
      gatewayAddress: null,
      gatewayConnectionString: null,
    },
  ],
}

beforeEach(() => {
  access.mockReset().mockResolvedValue(view)
  openBridge.mockReset().mockResolvedValue({ ok: true })
  closeBridge.mockReset().mockResolvedValue({ ok: true })
})

describe('the Access page', () => {
  it('opens a bridge for a service that has none', async () => {
    renderWithQuery(<Access />)
    const buttons = await screen.findAllByRole('button', { name: /Open local access/ })
    await userEvent.click(buttons[0] as HTMLElement)
    await waitFor(() => expect(openBridge).toHaveBeenCalledWith({ project: 'alpha', service: 'postgres' }))
  })

  it('closes an open bridge', async () => {
    renderWithQuery(<Access />)
    await screen.findByText('127.0.0.1:55431')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(closeBridge).toHaveBeenCalledWith('ab12cd'))
  })

  it('surfaces the reason a bridge could not open', async () => {
    openBridge.mockRejectedValue(
      Object.assign(new Error('the bridge image is not on this host'), {
        hint: 'docker pull alpine/socat:1.8.1.3',
      }),
    )
    renderWithQuery(<Access />)
    const buttons = await screen.findAllByRole('button', { name: /Open local access/ })
    await userEvent.click(buttons[0] as HTMLElement)

    expect(await screen.findByText('the bridge image is not on this host')).toBeInTheDocument()
    expect(screen.getByText('docker pull alpine/socat:1.8.1.3')).toBeInTheDocument()
  })

  it('does not offer a bridge for a service that is not running', async () => {
    access.mockResolvedValue({
      ...view,
      bridges: [],
      services: [{ ...view.services[0]!, state: 'exited' as const }],
    })
    renderWithQuery(<Access />)
    const button = await screen.findByRole('button', { name: /Open local access/ })
    expect(button).toBeDisabled()
  })
})
