import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const removalPreview = vi.fn()
const removeContainer = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    removalPreview: (...args: unknown[]) => removalPreview(...args),
    removeContainer: (...args: unknown[]) => removeContainer(...args),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    containerAction: vi.fn(),
  },
}))

const { RemoveDialog } = await import('@/components/container-actions')

const external = makeContainer({
  id: 'ext-pg',
  name: 'external-postgres',
  image: 'postgres:18.6-alpine',
  ownership: 'external',
  environment: 'external',
})

beforeEach(() => {
  removalPreview.mockReset().mockResolvedValue({
    containerId: 'ext-pg',
    name: 'external-postgres',
    image: 'postgres:18.6-alpine',
    ownership: 'external',
    state: 'running',
    project: 'external',
    mounts: [],
    namedVolumes: ['external_pgdata'],
    networks: ['external_default'],
    warnings: [
      'the container is running and will be stopped first',
      '1 named volume(s) stay on the host: external_pgdata',
      'networks are kept: external_default',
    ],
    allowed: true,
  })
  removeContainer.mockReset().mockResolvedValue({ ok: true })
})

describe('removing a container asks first, and says what stays', () => {
  it('removes nothing until the button is pressed', async () => {
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={() => {}} />)
    await screen.findByText('external_pgdata')
    expect(removeContainer).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Remove container' }))
    await waitFor(() => expect(removeContainer).toHaveBeenCalledWith('ext-pg', true))
  })

  it('refuses outright for a gateway component', async () => {
    removalPreview.mockResolvedValue({
      containerId: 'gw-traefik',
      name: 'portta-traefik-1',
      image: 'traefik:v3.7.12',
      ownership: 'gateway',
      state: 'running',
      project: null,
      mounts: [],
      namedVolumes: [],
      networks: [],
      warnings: ['this is a Portta component; the panel does not remove its own infrastructure'],
      allowed: false,
    })
    const gateway = makeContainer({ id: 'gw-traefik', name: 'portta-traefik-1', ownership: 'gateway' })
    renderWithQuery(<RemoveDialog container={gateway} open onOpenChange={() => {}} />)

    expect(await screen.findByText('The panel does not remove its own infrastructure')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove container' })).toBeDisabled()
  })

  it('shows the error and keeps the dialog open when Docker refuses', async () => {
    removeContainer.mockRejectedValue(Object.assign(new Error('permission denied'), { hint: 'check the socket proxy' }))
    renderWithQuery(<RemoveDialog container={external} open onOpenChange={() => {}} />)
    await screen.findByText('external_pgdata')

    await userEvent.click(screen.getByRole('button', { name: 'Remove container' }))
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    expect(screen.getByText('check the socket proxy')).toBeInTheDocument()
  })
})
