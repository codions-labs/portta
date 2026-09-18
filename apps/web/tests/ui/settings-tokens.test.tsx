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

const apiTokens = vi.fn()
const createApiToken = vi.fn()
const revokeApiToken = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    apiTokens: (...args: unknown[]) => apiTokens(...args),
    createApiToken: (...args: unknown[]) => createApiToken(...args),
    revokeApiToken: (...args: unknown[]) => revokeApiToken(...args),
  },
}))

const { TokensView } = await import('../../app/(panel)/settings/tokens/tokens-view.tsx')

const now = Math.floor(Date.now() / 1000)

function token(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k-1',
    name: 'laptop',
    start: 'ptt_abcd',
    actor: 'rita',
    actorKind: 'human',
    scopes: ['task:read', 'task:write'],
    createdAt: now - 600,
    expiresAt: now + 86_400,
    lastUsedAt: null,
    enabled: true,
    user: 'rita@example.test',
    ...overrides,
  }
}

const asDeveloper = principal({
  kind: 'user',
  name: 'Rita',
  email: 'rita@example.test',
  role: 'developer',
  permissions: ['token:read', 'token:create', 'token:revoke'],
})

beforeEach(() => {
  apiTokens.mockReset().mockResolvedValue([token()])
  createApiToken.mockReset().mockResolvedValue({
    token: 'ptt_the-secret-nobody-sees-twice',
    credential: token({ id: 'k-2', name: 'ci', start: 'ptt_ci00' }),
  })
  revokeApiToken.mockReset().mockResolvedValue({ ok: true, revoked: 'k-1' })
})

describe('the API tokens settings', () => {
  it('lists a token by what it is for, never by its secret', async () => {
    renderWithQuery(<TokensView />, undefined, asDeveloper)
    expect(await screen.findByText('laptop')).toBeInTheDocument()
    expect(screen.getByText('ptt_abcd…')).toBeInTheDocument()
    expect(screen.getByText('2 permissions')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
  })

  it('offers everybody’s tokens only to somebody who administers accounts', async () => {
    const { unmount } = renderWithQuery(<TokensView />, undefined, asDeveloper)
    await screen.findByText('laptop')
    expect(screen.queryByRole('radio', { name: 'Everybody’s' })).toBeNull()
    expect(apiTokens).toHaveBeenCalledWith(false)
    unmount()

    const asAdmin = principal({ kind: 'user', name: 'Ana', email: 'ana@example.test', role: 'admin' })
    renderWithQuery(<TokensView />, undefined, asAdmin)
    await screen.findByText('laptop')
    await userEvent.click(screen.getByRole('radio', { name: 'Everybody’s' }))
    expect(apiTokens).toHaveBeenCalledWith(true)
    expect(await screen.findByText('rita@example.test')).toBeInTheDocument()
  })

  it('shows the secret once, and will not close until somebody says they copied it', async () => {
    renderWithQuery(<TokensView />, undefined, asDeveloper)
    await screen.findByText('laptop')
    await userEvent.click(screen.getByRole('button', { name: 'New token' }))

    const form = await screen.findByRole('dialog')
    await userEvent.type(within(form).getByLabelText(/^Name/), 'ci', { delay: null })
    await userEvent.click(within(form).getByRole('button', { name: 'New token' }))

    expect(createApiToken).toHaveBeenCalledWith({ name: 'ci', actorKind: 'agent', expiresInDays: 90 })
    const shown = await screen.findByRole('dialog')
    expect(within(shown).getByText('ptt_the-secret-nobody-sees-twice')).toBeInTheDocument()
    expect(within(shown).getByText(/only time this secret is shown/)).toBeInTheDocument()
    // A stray escape must not take the secret away.
    await userEvent.keyboard('{Escape}')
    expect(within(await screen.findByRole('dialog')).getByText('ptt_the-secret-nobody-sees-twice')).toBeInTheDocument()

    await userEvent.click(within(shown).getByRole('button', { name: 'I copied it' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('revokes after a confirmation that says what stops working', async () => {
    renderWithQuery(<TokensView />, undefined, asDeveloper)
    await screen.findByText('laptop')
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/stops working on its next request/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    expect(revokeApiToken).toHaveBeenCalledWith('k-1')
  })
})
