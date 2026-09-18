import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { LogsResponse, ProjectLogSource, ProjectLogsResponse } from 'portta-contracts'
import { describe, expect, it, vi } from 'vitest'
import { LogViewer } from '@/components/logs'
import { renderWithQuery } from './render.tsx'

const response: LogsResponse = {
  containerId: 'c1',
  name: 'alpha-web-1',
  truncated: false,
  lines: [
    { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'listening on 3000' },
    { stream: 'stderr', timestamp: '2026-01-01T10:00:02Z', text: 'connection refused' },
    { stream: 'stdout', timestamp: '2026-01-01T10:00:03Z', text: 'retrying' },
  ],
}

describe('the log viewer', () => {
  it('copies what is on screen, not what was filtered out', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('retrying')

    await userEvent.type(screen.getByLabelText('Filter log lines'), 'retry', { delay: null })
    await userEvent.click(screen.getByRole('button', { name: 'Copy log' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('retrying')
  })

  it('asks for more lines when told to', async () => {
    const load = vi.fn().mockResolvedValue(response)
    renderWithQuery(<LogViewer queryKey={['x']} load={load} />)
    await screen.findByText('retrying')
    expect(load).toHaveBeenCalledWith(200)

    await userEvent.selectOptions(screen.getByLabelText('Number of lines'), '1000')
    await waitFor(() => expect(load).toHaveBeenCalledWith(1000))
  })

  it('reports a failure instead of showing an empty pane', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.reject(new Error('could not read logs'))} />)
    expect(await screen.findByText('could not read logs')).toBeInTheDocument()
  })
})

const SOURCES: ProjectLogSource[] = [
  {
    containerId: 'a-web',
    service: 'web',
    name: 'alpha-web-1',
    state: 'running',
    lineCount: 2,
    truncated: false,
    error: null,
  },
  {
    containerId: 'a-api',
    service: 'api',
    name: 'alpha-api-1',
    state: 'running',
    lineCount: 1,
    truncated: false,
    error: null,
  },
]

const projectResponse: ProjectLogsResponse = {
  project: 'alpha',
  sources: SOURCES,
  truncated: false,
  ordered: true,
  lines: [
    { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'web up', service: 'web' },
    { stream: 'stdout', timestamp: '2026-01-01T10:00:02Z', text: 'api up', service: 'api' },
  ],
}

describe('the log viewer across a project', () => {
  it('reports a source that failed beside the lines that arrived', async () => {
    const withFailure: ProjectLogsResponse = {
      ...projectResponse,
      sources: [SOURCES[0]!, { ...SOURCES[1]!, lineCount: 0, error: 'could not read logs: container is gone' }],
      lines: [projectResponse.lines[0]!],
    }
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve(withFailure)}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={() => {}}
      />,
    )
    expect(await screen.findByText('web up')).toBeInTheDocument()
    expect(screen.getByText('could not read logs: container is gone')).toBeInTheDocument()
  })
})
