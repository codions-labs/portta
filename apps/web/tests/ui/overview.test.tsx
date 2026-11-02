import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEnvironment, makeOverview } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

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
  exposure.mockReset().mockResolvedValue({ enforced: false, entries: [] })
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

  it('shows the address but no badge on a private host', async () => {
    arrange(false, [])
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('link', { name: 'app.example.com' })).toBeInTheDocument()
    expect(screen.queryByText('Protected')).not.toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })
})
