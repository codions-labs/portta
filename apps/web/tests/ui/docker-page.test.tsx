import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTAINERS, HOST } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const containers = vi.fn()
const host = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    containers: (...args: unknown[]) => containers(...args),
    host: () => host(),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    removeContainer: vi.fn().mockResolvedValue({ ok: true }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    // The Docker page joins the collector's per-container readings by id.
    metricsCurrent: vi.fn().mockResolvedValue({
      version: 1,
      instance: { id: '', name: null, hostname: null },
      collectedAt: null,
      ageSeconds: null,
      stale: true,
      collectorActive: false,
      host: null,
      runtime: null,
      projects: [],
    }),
  },
}))

const { DockerView: DockerPage } = await import('../../app/(panel)/docker/docker-view.tsx')

beforeEach(() => {
  containers.mockReset().mockResolvedValue({ containers: CONTAINERS, total: CONTAINERS.length })
  host.mockReset().mockResolvedValue(HOST)
})

describe('the Docker page', () => {
  const group = (name: string) => within(screen.getByRole('table', { name: new RegExp(name) }))

  it('filters by ownership', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /External Docker/ })

    await userEvent.selectOptions(screen.getByLabelText('Filter by ownership'), 'external')
    await waitFor(() => expect(screen.queryByRole('table', { name: /Integrated projects/ })).toBeNull())
    expect(group('External Docker').getByText('external-postgres')).toBeInTheDocument()
  })

  it('filters by state', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /Standalone containers/ })

    await userEvent.selectOptions(screen.getByLabelText('Filter by state'), 'stopped')
    await waitFor(() => expect(screen.queryByRole('table', { name: 'External Docker' })).toBeNull())
    expect(group('Standalone containers').getByText('some-old-container')).toBeInTheDocument()
  })

  it('searches across name, image and project', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('table', { name: /External Docker/ })

    await userEvent.type(screen.getByLabelText('Search containers'), 'postgres', { delay: null })
    await waitFor(() => expect(screen.queryByRole('table', { name: /Integrated projects/ })).toBeNull())
    expect(group('External Docker').getByText('external-postgres')).toBeInTheDocument()
  })
})
