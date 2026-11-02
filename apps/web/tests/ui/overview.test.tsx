import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment, makeOverview } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const developmentOverview = vi.fn()
const overview = vi.fn()
const metricsCurrent = vi.fn()
const metricsHistory = vi.fn()
const environments = vi.fn()
const exposure = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    developmentOverview: () => developmentOverview(),
    overview: () => overview(),
    metricsCurrent: () => metricsCurrent(),
    metricsHistory: () => metricsHistory(),
    environments: () => environments(),
    exposure: () => exposure(),
  },
}))

const { OverviewView: Overview } = await import('@/components/overview/overview-view')

beforeEach(() => {
  developmentOverview.mockReset().mockResolvedValue(makeOverview())
  overview.mockReset().mockResolvedValue({
    gateway: { up: true, panel: { readOnly: false, docs: true } },
    problems: [{ id: 'p', status: 'warn', title: 'Unhealthy containers', detail: 'x', fix: null }],
    counts: {},
    urls: [],
  })
  metricsCurrent.mockReset().mockResolvedValue({
    version: 1,
    instance: { id: 'i', name: 'lab', hostname: 'lab' },
    collectedAt: null,
    ageSeconds: null,
    stale: true,
    collectorActive: false,
    host: null,
    runtime: null,
    projects: [],
  })
  metricsHistory.mockReset().mockResolvedValue({ windowSeconds: 1800, points: [] })
  environments.mockReset().mockResolvedValue([])
  exposure.mockReset().mockResolvedValue({ enforced: false, entries: [], openRouters: { count: 0, names: [] } })
})

describe('the development dashboard', () => {
  it('falls back to the gateway status when the dashboard needs the database', async () => {
    developmentOverview.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<Overview />)
    expect(await screen.findByText("The development dashboard needs the panel's database")).toBeInTheDocument()
    expect(screen.getByText('Unhealthy containers')).toBeInTheDocument()
    expect(screen.getByText('Gateway running')).toBeInTheDocument()
  })
})

describe('who may open an environment on a public host', () => {
  const topProject = {
    slug: 'produto',
    name: 'Produto',
    environment: 'produto',
    cpuUtilisation: 0.1,
    memoryUsedBytes: 1000,
  }
  const route = {
    url: 'https://app.example.com',
    host: 'app.example.com',
    scope: 'public' as const,
    scheme: 'https' as const,
  }

  function arrange(enforced: boolean, entries: Array<{ host: string; mode: 'protected' | 'public' }>) {
    const base = makeOverview()
    developmentOverview.mockResolvedValue({
      ...base,
      resources: { ...base.resources, topProjects: [topProject] },
    })
    environments.mockResolvedValue([makeEnvironment({ name: 'produto', urls: [route] })])
    exposure.mockResolvedValue({
      enforced,
      openRouters: { count: 0, names: [] },
      entries: entries.map((entry) => ({ ...entry, user: null, project: null, service: null, label: 'x' })),
    })
  }

  it('shows the address and a protected badge', async () => {
    arrange(true, [{ host: 'APP.example.com', mode: 'protected' }])
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('link', { name: 'app.example.com' })).toHaveAttribute(
      'href',
      'https://app.example.com',
    )
    expect(await screen.findByText('Protected')).toBeInTheDocument()
  })

  it('says open for a public entry and closed for a host with no entry', async () => {
    arrange(true, [{ host: 'app.example.com', mode: 'public' }])
    const first = renderWithQuery(<Overview />)
    expect(await screen.findByText('Open')).toBeInTheDocument()
    first.unmount()
    arrange(true, [])
    renderWithQuery(<Overview />)
    expect(await screen.findByText('Closed')).toBeInTheDocument()
  })

  it('names a route without the gate instead of calling it closed', async () => {
    arrange(true, [])
    environments.mockResolvedValue([
      makeEnvironment({
        name: 'produto',
        urls: [route],
        services: [makeContainer({ id: 'open', service: 'web', urls: [route], labels: { 'traefik.enable': 'true' } })],
      }),
    ])
    renderWithQuery(<Overview />)
    expect((await screen.findAllByText('1 site answers everybody, with no login')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })

  it('shows the address but no badge on a private host', async () => {
    arrange(false, [])
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('link', { name: 'app.example.com' })).toBeInTheDocument()
    expect(screen.queryByText('Protected')).not.toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })
})

describe('the first use of a host', () => {
  const route = {
    url: 'https://app.example.com',
    host: 'app.example.com',
    scope: 'public' as const,
    scheme: 'https' as const,
  }

  function empty() {
    developmentOverview.mockResolvedValue({ ...makeOverview(), projects: [] })
  }

  beforeEach(() => {
    window.localStorage.clear()
    empty()
  })

  it('says where to start until there is a project', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('heading', { name: 'Your server is ready' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /I have a project with Compose/ })).toHaveAttribute('href', '/projects/new')
  })

  it('offers what is already running only when something is', async () => {
    renderWithQuery(<Overview />)
    await screen.findByRole('heading', { name: 'Your server is ready' })
    expect(screen.queryByRole('link', { name: /already have containers/ })).toBeNull()
  })

  it('counts environments no project owns', async () => {
    environments.mockResolvedValue([makeEnvironment({ name: 'loose' })])
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('link', { name: /1 Docker environment does not belong/ })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  it('has no account step on a panel that signs nobody in, and never claims the agents are taught', async () => {
    renderWithQuery(<Overview />)
    await screen.findByText('Prepare this server')
    expect(screen.queryByText('Protect your account')).toBeNull()
    const item = screen.getByText('Teach your agents').closest('li')
    expect(within(item as HTMLElement).getByText('Pending')).toBeInTheDocument()
  })

  it('does not hide a problem behind the welcome', async () => {
    environments.mockResolvedValue([
      makeEnvironment({
        name: 'open',
        urls: [route],
        services: [makeContainer({ id: 'o', urls: [route], labels: { 'traefik.enable': 'true' } })],
      }),
    ])
    exposure.mockResolvedValue({ enforced: true, entries: [], openRouters: { count: 0, names: [] } })
    renderWithQuery(<Overview />)
    await screen.findByRole('heading', { name: 'Your server is ready' })
    expect((await screen.findAllByText('1 site answers everybody, with no login')).length).toBeGreaterThan(0)
  })

  it('gets out of the way when asked, and remembers', async () => {
    const first = renderWithQuery(<Overview />)
    await userEvent.click(await screen.findByRole('button', { name: 'See the panel anyway' }))
    expect(screen.queryByRole('heading', { name: 'Your server is ready' })).toBeNull()
    first.unmount()
    renderWithQuery(<Overview />)
    await screen.findByRole('heading', { name: 'Home' })
    expect(screen.queryByRole('heading', { name: 'Your server is ready' })).toBeNull()
  })

  it('is not offered to somebody who cannot create a project', async () => {
    renderWithQuery(<Overview />, undefined, principal({ permissions: ['environment:read'] }))
    await screen.findByRole('heading', { name: 'Home' })
    expect(screen.queryByRole('heading', { name: 'Your server is ready' })).toBeNull()
  })
})
