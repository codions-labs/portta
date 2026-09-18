import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel } from '@/modules/taskflow/components/environments/environment-panel'

import type { Environment, EnvironmentService } from '@/modules/taskflow/lib/types'
import { cleanup, fakeProjectApi, fireEvent, render, screen, waitFor } from './render.tsx'

/** The Taskflow Project API every render below reads, replaced before each test. */
let api = fakeProjectApi()

const environment: Environment = {
  id: 'env_abc',
  provider: 'devcontainer',
  status: 'awaiting_trust',
  desiredStatus: 'ready',
  scope: { installationId: 'install', projectId: 'project', workspaceId: 'workspace' },
  workspace: { hostPath: '/repo', containerPath: '/workspaces/repo' },
  configRef: '.devcontainer/devcontainer.json',
  configHash: 'hash',
  capabilities: {
    exec: true,
    stdin: true,
    pty: true,
    resize: false,
    signals: true,
    reattach: false,
    services: true,
    rebuild: true,
  },
  security: {
    trusted: false,
    reasons: ['initializeCommand executes on the host'],
    initializeCommand: true,
    privileged: false,
    dockerSocket: false,
    devices: false,
    broadMounts: false,
    features: [],
    unpinnedFeatures: [],
    addedCapabilities: [],
    securityOptions: [],
    secretKeys: [],
    isolationRisks: [],
  },
  error: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

const service: EnvironmentService = {
  id: 'service_backend',
  environmentId: environment.id,
  name: 'backend',
  status: 'running',
  kind: 'http',
  containerIds: ['container'],
  ports: [{ containerPort: 8080, protocol: 'http', label: 'API' }],
  endpoints: [
    {
      id: 'endpoint_internal',
      serviceId: 'service_backend',
      url: 'http://127.0.0.1:8080',
      audiences: ['agent'],
      visibility: 'environment',
      accessMode: 'internal',
      executionLocus: 'environment',
      stable: true,
      provider: 'environment-network',
    },
  ],
  provenance: [{ source: 'compose', detail: 'service backend', confidence: 'explicit' }],
  actions: ['start', 'stop', 'restart'],
}

describe('EnvironmentPanel', () => {
  beforeEach(() => {
    api = fakeProjectApi()
    vi.clearAllMocks()
    api.fetchEnvironment.mockResolvedValue({ environment })
    api.fetchEnvironmentServices.mockResolvedValue({ services: [service] })
  })

  afterEach(() => cleanup())

  it('shows trust preflight and exposes a service only after explicit user action', async () => {
    const exposed: EnvironmentService = {
      ...service,
      endpoints: [
        ...service.endpoints,
        {
          id: 'endpoint_user',
          serviceId: service.id,
          url: 'http://backend-abc.localhost:5111',
          audiences: ['taskflow', 'user'],
          visibility: 'private',
          accessMode: 'localhost',
          executionLocus: 'host',
          stable: true,
          provider: 'local-http',
          providerResourceId: 'forward-1',
        },
      ],
    }
    api.exposeEnvironmentService.mockResolvedValue({ services: [exposed] })

    render(EnvironmentPanel, { props: { environmentId: environment.id } }, { api })

    expect(
      await screen.findByText(
        (_content, element) =>
          element?.tagName === 'P' && element.textContent === 'devcontainer · .devcontainer/devcontainer.json',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Review required')).toBeInTheDocument()
    expect(screen.getByText('initializeCommand executes on the host')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Review configuration' }))
    expect(screen.getByRole('heading', { name: 'Review Runtime configuration' })).toBeInTheDocument()
    expect(api.trustEnvironment).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await fireEvent.click(screen.getByRole('button', { name: 'Expose' }))
    await waitFor(() => expect(api.exposeEnvironmentService).toHaveBeenCalledWith(environment.id, service.id))
    expect(await screen.findByText('http://backend-abc.localhost:5111')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
  })

  it('offers supported service controls without exposing implementation details by default', async () => {
    api.fetchEnvironment.mockResolvedValue({ environment: { ...environment, status: 'ready' } })
    api.controlEnvironmentService.mockResolvedValue({ services: [{ ...service, status: 'stopped' }] })

    render(EnvironmentPanel, { props: { environmentId: environment.id } }, { api })

    await fireEvent.click(await screen.findByRole('button', { name: 'stop backend' }))
    await waitFor(() =>
      expect(api.controlEnvironmentService).toHaveBeenCalledWith(environment.id, service.id, { action: 'stop' }),
    )
    expect(screen.getAllByText('Details').length).toBeGreaterThan(0)
  })

  it('labels copied HTTP URLs and TCP addresses clearly', async () => {
    const userEndpoint: EnvironmentService['endpoints'][number] = {
      id: 'endpoint_http_user',
      serviceId: service.id,
      url: 'http://127.0.0.1:51110',
      audiences: ['taskflow', 'user'],
      visibility: 'private',
      accessMode: 'localhost',
      executionLocus: 'host',
      stable: false,
      provider: 'local-forward',
    }
    const database: EnvironmentService = {
      ...service,
      id: 'service_database',
      name: 'database',
      kind: 'database',
      ports: [{ containerPort: 5432, protocol: 'tcp' }],
      endpoints: [
        { ...userEndpoint, id: 'endpoint_tcp_user', serviceId: 'service_database', url: 'tcp://127.0.0.1:51111' },
      ],
    }
    api.fetchEnvironmentServices.mockResolvedValue({
      services: [{ ...service, endpoints: [...service.endpoints, userEndpoint] }, database],
    })

    render(EnvironmentPanel, { props: { environmentId: environment.id } }, { api })

    expect(await screen.findByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument()
  })

  it('shows Runtime controls only when Web Chat is the session interface', async () => {
    api.fetchEnvironment.mockResolvedValue({ environment: { ...environment, status: 'ready' } })

    const terminal = render(
      EnvironmentPanel,
      {
        props: { environmentId: environment.id, interfaceMode: 'terminal' },
      },
      { api },
    )
    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    terminal.unmount()

    render(
      EnvironmentPanel,
      {
        props: { environmentId: environment.id, interfaceMode: 'web_chat' },
      },
      { api },
    )
    expect(await screen.findByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('starts the Runtime from the trust review action', async () => {
    api.trustEnvironment.mockResolvedValue({
      environment: { ...environment, status: 'ready', security: { ...environment.security, trusted: true } },
    })

    render(EnvironmentPanel, { props: { environmentId: environment.id, interfaceMode: 'web_chat' } }, { api })
    await fireEvent.click(await screen.findByRole('button', { name: 'Review configuration' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Review & start' }))

    await waitFor(() => expect(api.trustEnvironment).toHaveBeenCalledWith(environment.id))
  })
})
