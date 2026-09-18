import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ContainerSummary, Environment } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeOperable, makeStartable } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

const environmentSettings = vi.fn()
const setEnvironmentSettings = vi.fn()
const clearEnvironmentSettings = vi.fn()
const serviceAlias = vi.fn()
const clearServiceAlias = vi.fn()
const projects = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    projects: () => Promise.resolve([]),
    environments: () => projects(),
    environmentSettings: (name: string) => environmentSettings(name),
    setEnvironmentSettings: (name: string, body: unknown) => setEnvironmentSettings(name, body),
    clearEnvironmentSettings: (name: string) => clearEnvironmentSettings(name),
    serviceAlias: (...args: unknown[]) => serviceAlias(...args),
    clearServiceAlias: (...args: unknown[]) => clearServiceAlias(...args),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    environmentAction: vi.fn().mockResolvedValue({
      ok: true,
      project: 'alpha',
      action: 'restart',
      requested: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      results: [],
    }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue({ shares: [] }),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    environmentGit: vi.fn().mockResolvedValue({ collected: false, git: null, refreshCommand: 'git scan' }),
  },
}))

const { EnvironmentSettingsForm } = await import('@/components/environment-settings')
const { ServiceAlias } = await import('@/components/service-alias')
const { EnvironmentsView: EnvironmentsPage } = await import('../../app/(panel)/environments/environments-view.tsx')

const WEB_URL = {
  url: 'http://alpha-web.localhost',
  host: 'alpha-web.localhost',
  scope: 'local' as const,
  scheme: 'http' as const,
}

const web: ContainerSummary = makeContainer({
  id: 'a-web',
  name: 'alpha-web-1',
  environment: 'alpha',
  service: 'web',
  ownership: 'integrated',
  traefikEnabled: true,
  kind: 'http',
  exposedPorts: [80],
  urls: [WEB_URL],
})

const worker: ContainerSummary = makeContainer({
  id: 'a-worker',
  name: 'alpha-worker-1',
  environment: 'alpha',
  service: 'worker',
  ownership: 'integrated',
  kind: 'tcp',
})

function project(overrides: Partial<Environment> = {}): Environment {
  return {
    name: 'alpha',
    presence: 'live',
    integrated: true,
    workingDir: '/srv/dev/alpha',
    operable: makeOperable('/srv/dev/alpha'),
    startable: makeStartable(),
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    serviceCount: 2,
    runningCount: 2,
    healthyCount: 2,
    unhealthyCount: 0,
    networks: ['portta'],
    startedAt: 1_700_000_000,
    uptimeSeconds: 60,
    scopes: ['local'],
    urls: [WEB_URL],
    services: [web, worker],
    ...overrides,
  }
}

beforeEach(() => {
  environmentSettings.mockReset().mockResolvedValue({})
  setEnvironmentSettings.mockReset().mockResolvedValue({})
  clearEnvironmentSettings.mockReset().mockResolvedValue({ ok: true, cleared: [] })
  serviceAlias.mockReset().mockResolvedValue({ host: 'shop.localhost', derivedHosts: [], port: 80 })
  clearServiceAlias.mockReset().mockResolvedValue({ ok: true, removed: 'shop.localhost' })
  projects.mockReset().mockResolvedValue([project()])
})

describe('the environment settings form', () => {
  it('sends only what the user set, and null for what they cleared', async () => {
    environmentSettings.mockResolvedValue({ description: 'old' })
    renderWithQuery(<EnvironmentSettingsForm project={project()} />)
    await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue('old'))

    await userEvent.clear(screen.getByLabelText('Description'))
    await userEvent.type(screen.getByLabelText('Display name'), 'Awesome Thing', { delay: null })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setEnvironmentSettings).toHaveBeenCalled())
    expect(setEnvironmentSettings.mock.calls[0]![1]).toMatchObject({
      displayName: 'Awesome Thing',
      description: null,
    })
  })

  it('reports an unavailable database instead of pretending to save', async () => {
    environmentSettings.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<EnvironmentSettingsForm project={project()} />)
    expect(await screen.findByText('panel persistence is unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('the alias control', () => {
  it('sets an alias for the service it belongs to', async () => {
    renderWithQuery(<ServiceAlias project="alpha" service={web} />)
    await userEvent.type(screen.getByLabelText('Hostname alias for web'), 'shop', { delay: null })
    await userEvent.click(screen.getByRole('button', { name: 'Add alias' }))
    await waitFor(() => expect(serviceAlias).toHaveBeenCalledWith('alpha', 'web', 'shop'))
  })

  it('renders a refusal inline rather than losing it', async () => {
    serviceAlias.mockRejectedValue(new ApiError(400, 'shop.localhost is already the hostname of a running container'))
    renderWithQuery(<ServiceAlias project="alpha" service={web} />)
    await userEvent.type(screen.getByLabelText('Hostname alias for web'), 'shop', { delay: null })
    await userEvent.click(screen.getByRole('button', { name: 'Add alias' }))
    expect(await screen.findByText('shop.localhost is already the hostname of a running container')).toBeInTheDocument()
  })

  it('removes an alias that is set', async () => {
    const aliased = { ...web, overrides: { alias: 'shop.localhost' } }
    renderWithQuery(<ServiceAlias project="alpha" service={aliased} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(clearServiceAlias).toHaveBeenCalledWith('alpha', 'web'))
  })
})

describe('the environment list under overrides', () => {
  it('collapses a hidden service rather than removing it', async () => {
    projects.mockResolvedValue([project({ overrides: { hiddenServices: ['worker'] } })])
    renderWithQuery(<EnvironmentsPage />)
    expect(await screen.findByText('1 collapsed service')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'worker service' })).toBeInTheDocument()
  })
})
