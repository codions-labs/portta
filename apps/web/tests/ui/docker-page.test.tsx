import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTAINERS, HOST } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'

const containers = vi.fn()
const host = vi.fn()
const containerAction = vi.fn()
const removeContainer = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    containers: (...args: unknown[]) => containers(...args),
    host: () => host(),
    containerAction: (...args: unknown[]) => containerAction(...args),
    removeContainer: (...args: unknown[]) => removeContainer(...args),
    logs: vi.fn().mockResolvedValue({ lines: [], truncated: false }),
  },
}))

const { DockerView: DockerPage } = await import('../../app/(panel)/host/containers/docker-view.tsx')

function rows() {
  return within(screen.getByRole('list', { name: 'Containers' })).getAllByRole('listitem')
}
const listed = (name: string) => rows().some((row) => within(row).queryByText(name) !== null)
const removable = CONTAINERS.filter((container) => container.ownership !== 'gateway')

beforeEach(() => {
  containers.mockReset().mockResolvedValue({ containers: CONTAINERS, total: CONTAINERS.length })
  host.mockReset().mockResolvedValue(HOST)
  containerAction.mockReset().mockResolvedValue({ ok: true })
  removeContainer.mockReset().mockResolvedValue({ ok: true })
})

describe('Host > Containers', () => {
  it('filters by where a container came from', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('list', { name: 'Containers' })
    await userEvent.click(screen.getByRole('button', { name: /^External/ }))
    await waitFor(() => expect(listed('portta-traefik-1')).toBe(false))
    expect(listed('external-postgres')).toBe(true)
  })

  it('searches across name, image and project', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('list', { name: 'Containers' })
    await userEvent.type(screen.getByLabelText('Search containers'), 'postgres', { delay: null })
    await waitFor(() => expect(listed('portta-traefik-1')).toBe(false))
    expect(listed('external-postgres')).toBe(true)
  })

  it("never lets Portta's own containers be selected", async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('list', { name: 'Containers' })
    expect(screen.getByRole('checkbox', { name: /portta-traefik-1 is part of Portta/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every selectable container' }))
    expect(screen.getByRole('toolbar', { name: 'Actions on the selected containers' })).toHaveTextContent(
      `${removable.length} containers selected`,
    )
    expect(screen.getByRole('checkbox', { name: /portta-traefik-1 is part of Portta/ })).not.toBeChecked()
  })

  it('select all covers only what the filter shows', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('list', { name: 'Containers' })
    await userEvent.click(screen.getByRole('button', { name: /^External/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every selectable container' }))
    const shown = rows().length
    expect(screen.getByRole('toolbar')).toHaveTextContent(
      shown === 1 ? '1 container selected' : `${shown} containers selected`,
    )
  })

  it('restarts every selected container', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('list', { name: 'Containers' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every selectable container' }))
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(containerAction).toHaveBeenCalledTimes(removable.length))
    expect(containerAction).toHaveBeenCalledWith(removable[0]?.id, 'restart')
  })

  it('removes only after the count is typed, and stops what is alive', async () => {
    renderWithQuery(<DockerPage />)
    await screen.findByRole('list', { name: 'Containers' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every selectable container' }))
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: new RegExp(`^Remove ${removable.length}`) })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox'), `remove ${removable.length}`, { delay: null })
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)

    await waitFor(() => expect(removeContainer).toHaveBeenCalledTimes(removable.length))
    for (const container of removable) {
      expect(removeContainer).toHaveBeenCalledWith(container.id, container.state === 'running')
    }
    for (const call of removeContainer.mock.calls) {
      expect(CONTAINERS.find((container) => container.id === call[0])?.ownership).not.toBe('gateway')
    }
  })

  it('offers no selection to somebody who can only read', async () => {
    renderWithQuery(<DockerPage />, undefined, principal({ permissions: ['docker:read'] }))
    await screen.findByRole('list', { name: 'Containers' })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
