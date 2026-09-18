import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPanel } from '@/modules/taskflow/components/settings/diagnostics-panel'
import { cleanup, fakeProjectApi, fireEvent, render, screen } from './render.tsx'

describe('DiagnosticsPanel', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders readiness checks and remediation', async () => {
    const api = fakeProjectApi()
    api.fetchDiagnostics.mockResolvedValue({
      ready: false,
      checkedAt: '2026-09-10T12:00:00.000Z',
      checks: [
        {
          id: 'codex-auto-review',
          label: 'Codex oneshot',
          status: 'error',
          required: true,
          summary: 'Automatic approval review is unavailable',
          remediation: 'Update Codex CLI',
        },
      ],
    })

    render(DiagnosticsPanel, {}, { api })
    await fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))

    expect(await screen.findByText('Action required')).toBeInTheDocument()
    expect(screen.getByText('Update Codex CLI')).toBeInTheDocument()
  })
})
