import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelPrincipal } from '@/lib/server/principal-view'
import { makeService } from './fixtures.ts'
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

const serviceAction = vi.fn()
const containerAction = vi.fn()
const openBridge = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    serviceAction: (...args: unknown[]) => serviceAction(...args),
    containerAction: (...args: unknown[]) => containerAction(...args),
    openBridge: (body: unknown) => openBridge(body),
  },
}))

const { ServiceRow, ServiceTableHead } = await import('@/components/entities/service-row')

function renderRow(service = makeService(), onOpen = vi.fn(), who?: PanelPrincipal) {
  const result = renderWithQuery(
    <table>
      <ServiceTableHead />
      <tbody>
        <ServiceRow service={service} onOpen={onOpen} />
      </tbody>
    </table>,
    'en',
    who,
  )
  return { ...result, onOpen }
}

beforeEach(() => {
  serviceAction.mockReset().mockResolvedValue({ ok: true })
  containerAction.mockReset().mockResolvedValue({ ok: true })
  openBridge.mockReset().mockResolvedValue({ ok: true })
})

describe('a service row', () => {
  it('does not render a console action without the stronger permission', () => {
    renderRow(makeService(), vi.fn(), principal({ role: 'viewer', permissions: ['service:read', 'logs:read'] }))
    expect(screen.queryByRole('button', { name: 'Console' })).not.toBeInTheDocument()
  })

  it('falls back to the container action when the panel has no service route yet', async () => {
    serviceAction.mockRejectedValue(new ApiError(404, 'not found'))
    renderRow()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for web' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }))
    await waitFor(() => expect(containerAction).toHaveBeenCalledWith('a-web', 'stop'))
  })
})
