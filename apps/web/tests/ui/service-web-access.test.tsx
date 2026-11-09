import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serviceFromContainer } from '@/lib/services'
import { makeContainer, makeEnvironment } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'

const gateway = vi.fn()
const serviceAlias = vi.fn()
const serviceHttpIntegration = vi.fn()
const serviceHttpIntegrationStatus = vi.fn()
const serviceConnection = vi.fn()
const environment = vi.fn()
const environmentServices = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class extends Error {},
  api: {
    gateway: () => gateway(),
    serviceAlias: (...args: unknown[]) => serviceAlias(...args),
    serviceHttpIntegration: (...args: unknown[]) => serviceHttpIntegration(...args),
    serviceHttpIntegrationStatus: (...args: unknown[]) => serviceHttpIntegrationStatus(...args),
    serviceConnection: (...args: unknown[]) => serviceConnection(...args),
    environment: () => environment(),
    environmentServices: () => environmentServices(),
    exposure: vi.fn().mockResolvedValue({ enforced: true, entries: [] }),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false }),
  },
}))
vi.mock('@/components/container-actions', () => ({ ContainerActions: () => null }))
vi.mock('@/components/container-console', () => ({ ContainerConsole: () => null }))
vi.mock('@/components/environment-logs', () => ({ EnvironmentLogs: () => null }))
vi.mock('@/components/environments/environment-git', () => ({ EnvironmentGit: () => null }))

const { ServiceDetails } = await import('@/components/entities/service-drawer')
const { EnvironmentOverview } = await import('@/components/environments/environment-overview')
const { ServiceTable } = await import('@/components/entities/service-table')

function mailpit(overrides = {}) {
  return makeContainer({
    id: 'mail-1',
    name: 'alpha-mailpit-1',
    service: 'mailpit',
    environment: 'alpha',
    kind: 'smtp',
    image: 'axllent/mailpit:latest',
    onGatewayNetwork: true,
    exposedPorts: [1025, 8025],
    containerPorts: [
      { port: 1025, protocol: 'tcp' },
      { port: 8025, protocol: 'tcp' },
    ],
    ...overrides,
  })
}

beforeEach(() => {
  navigation.search = ''
  environment.mockReset().mockResolvedValue(makeEnvironment({ services: [mailpit({ onGatewayNetwork: false })] }))
  environmentServices
    .mockReset()
    .mockResolvedValue({ services: [serviceFromContainer(mailpit({ onGatewayNetwork: false }))] })
  gateway
    .mockReset()
    .mockResolvedValue({ domain: 'dev.example.test', profile: 'remote-public', panel: { readOnly: false } })
  serviceAlias.mockReset().mockResolvedValue({
    host: 'alpha--mailpit.dev.example.test',
    port: 8025,
    hosts: [],
    dns: null,
    password: 'one-time-password',
    user: null,
  })
  serviceHttpIntegration.mockReset().mockResolvedValue({ ready: false, requestId: 'request-1' })
  serviceHttpIntegrationStatus.mockReset().mockResolvedValue({
    requestId: 'request-1',
    project: 'alpha',
    service: 'mailpit',
    port: 8025,
    state: 'ok',
    error: null,
  })
  serviceConnection.mockReset().mockResolvedValue({
    project: 'alpha',
    service: 'mailpit',
    kind: 'smtp',
    endpoints: [
      {
        provider: 'local',
        scope: 'local',
        url: '127.0.0.1:32768',
        usable: true,
        connectionString: 'smtp://127.0.0.1:32768',
      },
    ],
    credentials: { discovered: false, reason: 'No SMTP credentials' },
  })
})

describe('a web panel on a secondary service', () => {
  it('offers the Mailpit web port separately from SMTP, and shows the new password once', async () => {
    renderWithQuery(<ServiceDetails container={mailpit()} onLogs={vi.fn()} />)
    const port = await screen.findByRole('combobox', { name: 'Web port' })
    expect(port).toHaveValue('8025')
    expect(within(port).queryByRole('option', { name: /1025/ })).not.toBeInTheDocument()
    expect(screen.getByText('1025/tcp')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('127.0.0.1:32768')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create web address' }))
    await waitFor(() =>
      expect(serviceAlias).toHaveBeenCalledWith('alpha', 'mailpit', 'alpha--mailpit.dev.example.test', {
        port: 8025,
        protect: true,
      }),
    )
    expect(serviceHttpIntegration).not.toHaveBeenCalled()
    expect(await screen.findByText('one-time-password')).toBeInTheDocument()
    expect(screen.queryByText('Share with a client')).not.toBeInTheDocument()
  })

  it('waits for its own integration request before creating the URL, across a container recreation', async () => {
    let complete!: (value: unknown) => void
    serviceHttpIntegrationStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const { rerender } = renderWithQuery(
      <ServiceDetails container={mailpit({ onGatewayNetwork: false })} onLogs={vi.fn()} />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Create web address' }))
    await waitFor(() => expect(serviceHttpIntegrationStatus).toHaveBeenCalledWith('alpha', 'mailpit', 'request-1'))
    expect(serviceAlias).not.toHaveBeenCalled()
    rerender(<ServiceDetails container={mailpit({ id: 'mail-2' })} onLogs={vi.fn()} />)
    complete({ requestId: 'request-1', project: 'alpha', service: 'mailpit', port: 8025, state: 'ok', error: null })
    await waitFor(() => expect(serviceAlias).toHaveBeenCalledTimes(1))
    expect(serviceHttpIntegration).toHaveBeenCalledWith('alpha', 'mailpit', {
      alias: 'alpha--mailpit.dev.example.test',
      port: 8025,
    })
  })

  it('reports an integration failure without advertising or creating a URL', async () => {
    serviceHttpIntegrationStatus.mockResolvedValue({
      requestId: 'request-1',
      project: 'alpha',
      service: 'mailpit',
      port: 8025,
      state: 'failed',
      error: 'Compose refused the selected service',
    })
    renderWithQuery(<ServiceDetails container={mailpit({ onGatewayNetwork: false })} onLogs={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Create web address' }))
    expect(await screen.findByText('Compose refused the selected service')).toBeInTheDocument()
    expect(serviceAlias).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Open site' })).not.toBeInTheDocument()
  })

  it('keeps the integration form mounted while the Docker snapshot briefly contains no service', async () => {
    let complete!: (value: unknown) => void
    serviceHttpIntegrationStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    navigation.search = 'service=mailpit'
    const { client } = renderWithQuery(<EnvironmentOverview name="alpha" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Create web address' }))
    await waitFor(() => expect(serviceHttpIntegrationStatus).toHaveBeenCalledTimes(1))
    act(() => {
      client.setQueryData(['environments', 'alpha'], makeEnvironment({ services: [] }))
      client.setQueryData(['environments', 'alpha', 'services'], { services: [] })
    })
    expect(screen.getByText('Connecting this service to the gateway…')).toBeInTheDocument()
    complete({ requestId: 'request-1', project: 'alpha', service: 'mailpit', port: 8025, state: 'ok', error: null })
    expect(await screen.findByText('one-time-password')).toBeInTheDocument()
    expect(serviceAlias).toHaveBeenCalledTimes(1)
  })

  it('keeps the global service drawer selected while the integrated container is replaced', async () => {
    let complete!: (value: unknown) => void
    serviceHttpIntegrationStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const container = mailpit({ onGatewayNetwork: false })
    const { rerender } = renderWithQuery(
      <ServiceTable services={[serviceFromContainer(container)]} containers={[container]} initialService="mailpit" />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Create web address' }))
    await waitFor(() => expect(serviceHttpIntegrationStatus).toHaveBeenCalledTimes(1))
    rerender(<ServiceTable services={[]} containers={[]} initialService="mailpit" />)
    expect(screen.getByText('Connecting this service to the gateway…')).toBeInTheDocument()
    const replaced = mailpit({ id: 'mail-2' })
    rerender(
      <ServiceTable services={[serviceFromContainer(replaced)]} containers={[replaced]} initialService="mailpit" />,
    )
    complete({ requestId: 'request-1', project: 'alpha', service: 'mailpit', port: 8025, state: 'ok', error: null })
    expect(await screen.findByText('one-time-password')).toBeInTheDocument()
    expect(serviceAlias).toHaveBeenCalledTimes(1)
  })

  it('requires an HTTP decision for an unknown port and excludes UDP', async () => {
    const custom = mailpit({
      image: 'custom/tool:1',
      exposedPorts: [7000, 8025],
      containerPorts: [
        { port: 7000, protocol: 'tcp' },
        { port: 8025, protocol: 'udp' },
      ],
    })
    renderWithQuery(<ServiceDetails container={custom} onLogs={vi.fn()} />)
    const submit = await screen.findByRole('button', { name: 'Create web address' })
    expect(submit).toBeDisabled()
    const port = screen.getByRole('combobox', { name: 'Web port' })
    expect(within(port).queryByRole('option', { name: /8025/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'This service speaks HTTP on port 7000.' }))
    await userEvent.click(submit)
    await waitFor(() =>
      expect(serviceAlias).toHaveBeenCalledWith('alpha', 'mailpit', 'alpha--mailpit.dev.example.test', {
        port: 7000,
        protect: true,
      }),
    )
  })

  it('keeps a raw MySQL port visible without offering it as a web address', async () => {
    renderWithQuery(
      <ServiceDetails
        container={makeContainer({
          image: 'mysql:8.4',
          kind: 'mysql',
          service: 'mysql',
          environment: 'alpha',
          exposedPorts: [3306],
        })}
        onLogs={vi.fn()}
      />,
    )
    expect(screen.getByText('3306/tcp')).toBeInTheDocument()
    await waitFor(() => expect(gateway).toHaveBeenCalled())
    expect(screen.queryByRole('combobox', { name: 'Web port' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create web address' })).not.toBeInTheDocument()
  })

  it('offers no address mutation in read-only mode or without integration permission', async () => {
    gateway.mockResolvedValue({ domain: 'dev.example.test', profile: 'remote-public', panel: { readOnly: true } })
    const { unmount } = renderWithQuery(<ServiceDetails container={mailpit()} onLogs={vi.fn()} />)
    await waitFor(() => expect(gateway).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Create web address' })).not.toBeInTheDocument()
    unmount()
    gateway.mockResolvedValue({ domain: 'dev.example.test', profile: 'remote-public', panel: { readOnly: false } })
    renderWithQuery(
      <ServiceDetails container={mailpit({ onGatewayNetwork: false })} onLogs={vi.fn()} />,
      'en',
      principal({ permissions: ['service:read', 'environment:settings', 'service:protect'] }),
    )
    await waitFor(() => expect(gateway).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Create web address' })).not.toBeInTheDocument()
  })
})
