import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeOverview } from './fixtures.ts'
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

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    developmentOverview: () => developmentOverview(),
    overview: () => overview(),
    metricsCurrent: () => metricsCurrent(),
    metricsHistory: () => metricsHistory(),
    environments: () => environments(),
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
