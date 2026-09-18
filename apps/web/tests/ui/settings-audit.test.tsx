import { screen } from '@testing-library/react'
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

const audit = vi.fn()
const users = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    audit: (...args: unknown[]) => audit(...args),
    users: () => users(),
  },
}))

const { AuditView } = await import('../../app/(panel)/settings/audit/audit-view.tsx')

const now = Math.floor(Date.now() / 1000)

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: '42',
    at: now - 120,
    userId: 'u-1',
    userEmail: 'ana@example.test',
    principalKind: 'user',
    actor: 'ana',
    action: 'user.created',
    resourceType: 'user',
    resourceId: 'u-2',
    resourceName: 'rita@example.test',
    project: null,
    ipAddress: '10.0.0.4',
    metadata: {},
    ...overrides,
  }
}

beforeEach(() => {
  audit.mockReset().mockResolvedValue({ entries: [entry()], nextBefore: null })
  users.mockReset().mockResolvedValue([
    {
      id: 'u-1',
      name: 'Ana',
      email: 'ana@example.test',
      role: 'owner',
      banned: false,
      banReason: null,
      banExpires: null,
      twoFactorEnabled: false,
      createdAt: now,
      projects: [],
    },
  ])
})

describe('the Audit settings', () => {
  it('narrows to one account, and asks for the page before it', async () => {
    audit.mockResolvedValue({ entries: [entry()], nextBefore: '41' })
    renderWithQuery(<AuditView />, undefined, principal())
    await screen.findByText('user.created')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by user' }), 'u-1')
    expect(audit).toHaveBeenCalledWith({ user: 'u-1' })

    await userEvent.click(screen.getByRole('button', { name: 'Older entries' }))
    expect(audit).toHaveBeenCalledWith({ user: 'u-1', before: '41' })
  })

  it('offers no filter to somebody who cannot list accounts', async () => {
    renderWithQuery(<AuditView />, undefined, principal({ permissions: ['audit:read'] }))
    await screen.findByText('user.created')
    expect(screen.queryByRole('combobox', { name: 'Filter by user' })).toBeNull()
  })
})
