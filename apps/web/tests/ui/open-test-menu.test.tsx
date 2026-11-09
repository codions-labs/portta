import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeService } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    openBridge: vi.fn().mockResolvedValue({ ok: true }),
    closeBridge: vi.fn().mockResolvedValue({ ok: true }),
    serviceConnection: vi.fn().mockResolvedValue({
      project: 'alpha',
      service: 'postgres',
      kind: 'postgres',
      endpoints: [
        {
          provider: 'internal',
          url: 'postgres:5432',
          scope: 'internal',
          usable: true,
          shareable: false,
          problem: null,
          connectionString: 'postgres://user@postgres:5432/app',
        },
      ],
      credentials: {
        discovered: true,
        user: 'user',
        password: 'hunter2',
        database: 'app',
        source: 'env',
        reason: null,
      },
    }),
  },
}))

const { OpenTestMenu } = await import('@/components/entities/open-test-menu')

describe('the Open / Test menu', () => {
  it('lists every address by scope, nearest first, and opens one', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderWithQuery(<OpenTestMenu service={makeService()} onLogs={() => {}} />, 'en')
    await userEvent.click(screen.getByRole('button', { name: 'Open / Test' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'http://alpha--web.localhost',
      'https://alpha--web.dev.example.test',
      'Logs',
    ])
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('public')).toBeInTheDocument()
    await userEvent.click(items[1]!)
    expect(open).toHaveBeenCalledWith('https://alpha--web.dev.example.test', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('copies the TCP address of a mixed service instead of opening it as a website', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const web = makeService()
    const smtp = {
      provider: 'bridge',
      url: '127.0.0.1:32768',
      scope: 'local' as const,
      usable: true,
      shareable: false,
      problem: null,
      protocol: 'tcp' as const,
    }
    renderWithQuery(
      <OpenTestMenu
        service={{
          ...web,
          kind: 'smtp',
          access: { ...web.access, endpoints: [...web.access.endpoints, smtp] },
          actions: { ...web.actions, openAccess: true, share: false },
        }}
      />,
      'en',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open / Test' }))
    expect(await screen.findByRole('menuitem', { name: 'Open local access' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: '127.0.0.1:32768' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('127.0.0.1:32768')
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
