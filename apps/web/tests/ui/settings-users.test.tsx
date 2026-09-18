import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { principal, renderWithQuery } from './render.tsx'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const users = vi.fn()
const projects = vi.fn()
const createUser = vi.fn()
const setUserRole = vi.fn()
const banUser = vi.fn()
const removeUser = vi.fn()
const transferOwnership = vi.fn()
const setUserProjects = vi.fn()
const userSessions = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    users: () => users(),
    projects: () => projects(),
    createUser: (...args: unknown[]) => createUser(...args),
    setUserRole: (...args: unknown[]) => setUserRole(...args),
    banUser: (...args: unknown[]) => banUser(...args),
    removeUser: (...args: unknown[]) => removeUser(...args),
    transferOwnership: (...args: unknown[]) => transferOwnership(...args),
    setUserProjects: (...args: unknown[]) => setUserProjects(...args),
    userSessions: (...args: unknown[]) => userSessions(...args),
  },
}))

const { UsersView } = await import('../../app/(panel)/settings/users/users-view.tsx')

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-2',
    name: 'Rita',
    email: 'rita@example.test',
    role: 'developer',
    banned: false,
    banReason: null,
    banExpires: null,
    twoFactorEnabled: false,
    createdAt: Math.floor(Date.now() / 1000) - 3600,
    projects: [{ id: 1, slug: 'shop', name: 'Shop' }],
    ...overrides,
  }
}

const OWNER = {
  id: 'u-1',
  name: 'Ana',
  email: 'ana@example.test',
  role: 'owner',
  banned: false,
  banReason: null,
  banExpires: null,
  twoFactorEnabled: true,
  createdAt: Math.floor(Date.now() / 1000) - 86400,
  projects: [],
}

const asOwner = principal({ kind: 'user', name: 'Ana', email: 'ana@example.test', role: 'owner' })

beforeEach(() => {
  users.mockReset().mockResolvedValue([OWNER, user()])
  projects.mockReset().mockResolvedValue([
    {
      id: '1',
      slug: 'shop',
      name: 'Shop',
      description: null,
      archived: false,
      relativePath: null,
      location: 'external',
      repositoryCount: 0,
      environmentCount: 0,
      runningEnvironmentCount: 0,
      environments: [],
    },
  ])
  createUser.mockReset().mockResolvedValue(user({ id: 'u-3', name: 'Novo' }))
  setUserRole.mockReset().mockResolvedValue(user({ role: 'viewer' }))
  banUser.mockReset().mockResolvedValue(user({ banned: true }))
  removeUser.mockReset().mockResolvedValue({ ok: true })
  transferOwnership.mockReset().mockResolvedValue(user({ role: 'owner' }))
  setUserProjects.mockReset().mockResolvedValue(user())
  userSessions.mockReset().mockResolvedValue([])
})

describe('the Users settings', () => {
  it('changes a role from the row menu', async () => {
    renderWithQuery(<UsersView />, undefined, asOwner)
    await screen.findByText('Rita')
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Rita' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make Viewer' }))
    expect(setUserRole).toHaveBeenCalledWith('u-2', 'viewer')
  })

  it('offers no role change, no ban and no removal on your own row', async () => {
    renderWithQuery(<UsersView />, undefined, asOwner)
    await screen.findByText('Rita')
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Ana' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Make Viewer' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Ban' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Remove' })).toBeNull()
  })

  it('asks for the email before removing an account', async () => {
    renderWithQuery(<UsersView />, undefined, asOwner)
    await screen.findByText('Rita')
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Rita' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Remove' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox'), 'rita@example.test', { delay: null })
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(removeUser).toHaveBeenCalledWith('u-2')
  })

  it('creates an account with a role and the Projects it reaches', async () => {
    renderWithQuery(<UsersView />, undefined, asOwner)
    await screen.findByText('Rita')
    await userEvent.click(screen.getByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Novo', { delay: null })
    await userEvent.type(within(dialog).getByLabelText(/^Email/), 'novo@example.test', { delay: null })
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'a-long-password', { delay: null })
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'New user' }))
    expect(createUser).toHaveBeenCalledWith({
      name: 'Novo',
      email: 'novo@example.test',
      password: 'a-long-password',
      role: 'viewer',
      projects: [1],
    })
  })

  it('offers transfer only to the owner, and never to themselves', async () => {
    const { unmount } = renderWithQuery(<UsersView />, undefined, asOwner)
    await screen.findByText('Rita')
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Rita' }))
    expect(await screen.findByRole('menuitem', { name: 'Transfer ownership' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    unmount()

    const asAdmin = principal({ kind: 'user', name: 'Bea', email: 'bea@example.test', role: 'admin' })
    renderWithQuery(<UsersView />, undefined, asAdmin)
    await screen.findByText('Rita')
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Rita' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Transfer ownership' })).toBeNull()
  })

  it('keeps an administrator away from the owner', async () => {
    const asAdmin = principal({ kind: 'user', name: 'Bea', email: 'bea@example.test', role: 'admin' })
    renderWithQuery(<UsersView />, undefined, asAdmin)
    await screen.findByText('Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Ana' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Set a password' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Ban' })).toBeNull()
  })

  it('shows nothing to act with when the role holds nothing', async () => {
    const asViewer = principal({
      kind: 'user',
      name: 'Rita',
      email: 'rita@example.test',
      role: 'viewer',
      permissions: ['user:list', 'project:read'],
    })
    renderWithQuery(<UsersView />, undefined, asViewer)
    await screen.findByText('Ana')
    expect(screen.queryByRole('button', { name: 'New user' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Ana' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryAllByRole('menuitem')).toHaveLength(0)
  })
})
