import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Project } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const NONE = { search: false, train: false, live: false, preview: false }
const projectCrawlers = vi.fn()
const setProjectCrawlers = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class extends Error {},
  api: {
    projectCrawlers: (...args: unknown[]) => projectCrawlers(...args),
    setProjectCrawlers: (...args: unknown[]) => setProjectCrawlers(...args),
    exposure: async () => ({ enforced: false, entries: [], openRouters: { count: 0, names: [] } }),
  },
}))

const { ProjectCrawlers } = await import('@/components/projects/project-crawlers')

const project = { slug: 'shop', name: 'Shop', environments: [] } as unknown as Project

beforeEach(() => {
  projectCrawlers.mockReset().mockResolvedValue({ default: NONE, own: null, effective: NONE, mixed: false })
  setProjectCrawlers.mockReset().mockResolvedValue({ default: NONE, own: NONE, effective: NONE, mixed: false })
})

describe('letting a crawler into a project', () => {
  it('follows the default and saves nothing until something changes', async () => {
    renderWithQuery(<ProjectCrawlers project={project} mayEdit />)
    expect(await screen.findByRole('radio', { name: /Follow the server default/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('will not save an exception until the person says they understand it cannot be undone', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ProjectCrawlers project={project} mayEdit />)
    await user.click(await screen.findByRole('radio', { name: /Allow some/ }))
    await user.click(screen.getAllByRole('radio', { name: 'Allow' })[0] as HTMLElement)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /I understand/ }))
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(setProjectCrawlers).toHaveBeenCalledWith('shop', { ...NONE, search: true }))
  })

  it('blocking everything needs no confirmation, since it is the safe direction', async () => {
    const user = userEvent.setup()
    projectCrawlers.mockResolvedValue({
      default: { ...NONE, search: true },
      own: null,
      effective: { ...NONE, search: true },
      mixed: false,
    })
    renderWithQuery(<ProjectCrawlers project={project} mayEdit />)
    await user.click(await screen.findByRole('radio', { name: /Block all/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setProjectCrawlers).toHaveBeenCalledWith('shop', NONE))
  })
})
