import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Environment } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment, makeOperable, makeStartable } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const environments = vi.fn()
const projects = vi.fn()
const project = vi.fn()
const containerAction = vi.fn()
const environmentAction = vi.fn()
const serviceAction = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 0
  },
  api: {
    projects: () => projects(),
    project: (slug: string) => project(slug),
    environments: () => environments(),
    containerAction: (...args: unknown[]) => containerAction(...args),
    serviceAction: (...args: unknown[]) => serviceAction(...args),
    environmentAction: (...args: unknown[]) => environmentAction(...args),
    forgetEnvironment: vi.fn().mockResolvedValue({ ok: true, forgotten: 'gamma' }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue([]),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    environmentGit: vi.fn().mockResolvedValue({ collected: false, git: null, refreshCommand: 'portta repos scan' }),
    metricsCurrent: vi.fn().mockResolvedValue({ projects: [], collectorActive: false, stale: true }),
  },
}))

const { EnvironmentsView: EnvironmentsPage } = await import('../../app/(panel)/environments/environments-view.tsx')

const WEB_URL = {
  url: 'http://alpha-web.localhost',
  host: 'alpha-web.localhost',
  scope: 'local' as const,
  scheme: 'http' as const,
}
const API_URLS = [
  {
    url: 'https://alpha-api.vpn.example.test',
    host: 'alpha-api.vpn.example.test',
    scope: 'vpn' as const,
    scheme: 'https' as const,
  },
  { url: 'http://alpha-api.localhost', host: 'alpha-api.localhost', scope: 'local' as const, scheme: 'http' as const },
]

const alpha: Environment = {
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
  serviceCount: 4,
  runningCount: 4,
  healthyCount: 2,
  unhealthyCount: 0,
  networks: ['portta', 'alpha_default'],
  startedAt: 1_700_000_000,
  uptimeSeconds: 7200,
  scopes: ['local'],
  urls: [WEB_URL, ...API_URLS],
  services: [
    makeContainer({
      id: 'a-web',
      name: 'alpha-web-1',
      environment: 'alpha',
      service: 'web',
      ownership: 'integrated',
      traefikEnabled: true,
      onGatewayNetwork: true,
      kind: 'http',
      exposedPorts: [3000],
      uptimeSeconds: 7200,
      urls: [WEB_URL],
    }),
    makeContainer({
      id: 'a-postgres',
      name: 'alpha-postgres-1',
      image: 'postgres:18.6-alpine',
      environment: 'alpha',
      service: 'postgres',
      ownership: 'integrated',
      kind: 'postgres',
      exposedPorts: [5432],
    }),
    makeContainer({
      id: 'a-redis',
      name: 'alpha-redis-1',
      image: 'redis:8.10.1-alpine',
      environment: 'alpha',
      service: 'redis',
      ownership: 'integrated',
      kind: 'redis',
      exposedPorts: [6379],
    }),
    makeContainer({
      id: 'a-api',
      name: 'alpha-api-1',
      environment: 'alpha',
      service: 'api',
      ownership: 'integrated',
      traefikEnabled: true,
      onGatewayNetwork: true,
      kind: 'http',
      urls: API_URLS,
    }),
  ],
}

const beta: Environment = {
  ...alpha,
  name: 'beta',
  namespace: 'beta-issue59',
  serviceCount: 1,
  runningCount: 1,
  unhealthyCount: 1,
  urls: [],
  services: [
    makeContainer({
      id: 'b-web',
      name: 'beta-web-1',
      environment: 'beta',
      service: 'web',
      ownership: 'integrated',
      health: 'unhealthy',
      traefikEnabled: true,
      onGatewayNetwork: true,
      kind: 'http',
    }),
  ],
}

beforeEach(() => {
  environments.mockReset().mockResolvedValue([alpha, beta])
  projects.mockReset().mockResolvedValue([{ slug: 'shop', name: 'Shop' }])
  project
    .mockReset()
    .mockResolvedValue({ slug: 'shop', name: 'Shop', repositories: [], environments: [{ environment: 'alpha' }] })
  containerAction.mockReset().mockResolvedValue({ ok: true })
  serviceAction.mockReset().mockResolvedValue({ ok: true })
  environmentAction.mockReset()
})

describe('the Environments page', () => {
  it('filters out adopted environments', async () => {
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByRole('link', { name: 'Project: Shop' })
    await userEvent.selectOptions(screen.getAllByLabelText('Filter environments')[0]!, 'unattributed')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'beta' })).toBeInTheDocument()
  })

  it('sends a service action through the service route', async () => {
    renderWithQuery(<EnvironmentsPage />)
    const web = (await screen.findAllByRole('row', { name: 'web service' }))[0] as HTMLElement
    await userEvent.click(within(web).getByRole('button', { name: 'Actions for web' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Restart' }))
    await waitFor(() => expect(serviceAction).toHaveBeenCalledWith('alpha', 'web', 'restart'))
    expect(containerAction).not.toHaveBeenCalled()
  })

  it('lists a remembered environment as not running, after the live ones, with Start and Forget', async () => {
    const gamma = makeEnvironment({ name: 'gamma', presence: 'remembered', workingDir: '/srv/dev/gamma' })
    environments.mockResolvedValue([gamma, alpha, beta])
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByRole('link', { name: 'gamma' })
    const headings = screen.getAllByRole('link', { name: /^(alpha|beta|gamma)$/ }).map((link) => link.textContent)
    expect(headings).toEqual(['alpha', 'beta', 'gamma'])
    expect(screen.getByText('Not running', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('0/0 running')).toBeNull()
    expect(screen.getByText('Containers were removed. Start recreates them through the runner.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forget' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(2)
  })

  it('filters down to the remembered ones', async () => {
    environments.mockResolvedValue([alpha, beta, makeEnvironment({ name: 'gamma', presence: 'remembered' })])
    renderWithQuery(<EnvironmentsPage />)
    await screen.findByRole('link', { name: 'gamma' })
    await userEvent.selectOptions(screen.getAllByLabelText('Filter environments')[0]!, 'remembered')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'gamma' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getAllByLabelText('Filter environments')[0]!, 'running')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'gamma' })).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'alpha' })).toBeInTheDocument()
  })
})
