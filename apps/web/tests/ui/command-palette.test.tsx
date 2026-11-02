import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestConsole, takeConsoleRequest } from '@/lib/console-request'
import { folded } from '@/lib/utils'
import { makeContainer, makeEnvironment } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'

const serviceAction = vi.fn()
const environments = vi.fn()

class ApiError extends Error {}

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    projects: () => Promise.resolve([]),
    environments: () => environments(),
    exposure: () => Promise.resolve({ enforced: true, entries: [], openRouters: { count: 0, names: [] } }),
    metricsCurrent: () => Promise.resolve({ projects: [] }),
    serviceAction: (...args: unknown[]) => serviceAction(...args),
  },
}))

const { CommandPalette } = await import('@/components/command-palette')

const web = (environment: string) =>
  makeContainer({
    id: `${environment}-web`,
    name: `${environment}-web-1`,
    service: 'web',
    environment,
    ownership: 'integrated',
    kind: 'http',
    state: 'running',
    labels: {
      'traefik.enable': 'true',
      'traefik.http.routers.web.rule': `Host(\`${environment}-web.test\`)`,
      'traefik.http.routers.web.middlewares': 'portta-forward-auth@file',
    },
    urls: [
      { url: `https://${environment}-web.test`, host: `${environment}-web.test`, scope: 'public', scheme: 'https' },
    ],
  })

function palette(who = principal()) {
  renderWithQuery(
    <CommandPalette open onOpenChange={() => undefined} toggleSidebar={() => undefined} />,
    undefined,
    who,
  )
  return screen.getByRole('combobox')
}

async function search(text: string, who = principal()) {
  const box = palette(who)
  await waitFor(() => expect(environments).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  await userEvent.type(box, text, { delay: null })
  return box
}

beforeEach(() => {
  serviceAction.mockReset().mockResolvedValue({ ok: true })
  environments
    .mockReset()
    .mockResolvedValue([
      makeEnvironment({ name: 'demo-shop-issue312', services: [web('demo-shop-issue312')] }),
      makeEnvironment({ name: 'demo-shop', services: [web('demo-shop')] }),
    ])
})

describe('the command menu', () => {
  it('puts what can be done to the service first, and the closest match above its namesakes', async () => {
    await search('shop web')
    const target = await screen.findByRole('group', { name: 'demo-shop / web' })
    expect(within(target).getByRole('option', { name: /Open site/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(target).getByRole('option', { name: /Copy address/ })).toBeInTheDocument()
    const also = screen.getByRole('group', { name: 'Also found' })
    expect(within(also).getByRole('option', { name: /demo-shop-issue312 \/ web/ })).toBeInTheDocument()
  })

  it('shows how the service is doing beside the list', async () => {
    await search('shop web')
    const preview = await screen.findByRole('complementary', { name: 'How web is doing' })
    expect(within(preview).getByText('https://demo-shop-web.test')).toBeInTheDocument()
    expect(within(preview).getByText('Closed')).toBeInTheDocument()
  })

  it('restarts from Alt with the letter, and leaves the letter itself to the search', async () => {
    const box = await search('shop web')
    await screen.findByRole('group', { name: 'demo-shop / web' })
    await userEvent.keyboard('{Alt>}r{/Alt}')
    await waitFor(() => expect(serviceAction).toHaveBeenCalledWith('demo-shop', 'web', 'restart'))
    expect(box).toHaveValue('shop web')
  })

  it('does not offer what this person may not do', async () => {
    await search('shop web', principal({ permissions: ['environment:read', 'access:read'] }))
    const target = await screen.findByRole('group', { name: 'demo-shop / web' })
    expect(within(target).queryByRole('option', { name: /Restart/ })).toBeNull()
    expect(within(target).queryByRole('option', { name: /Open console/ })).toBeNull()
    expect(within(target).queryByRole('option', { name: /View logs/ })).toBeNull()
  })

  it('offers a database a way in, and no site to open', async () => {
    environments.mockResolvedValue([
      makeEnvironment({
        name: 'demo-shop',
        services: [
          makeContainer({
            id: 'pg',
            name: 'demo-shop-postgres-1',
            service: 'postgres',
            kind: 'postgres',
            exposedPorts: [5432],
            state: 'running',
          }),
        ],
      }),
    ])
    await search('postgres')
    const target = await screen.findByRole('group', { name: 'demo-shop / postgres' })
    expect(within(target).getByRole('option', { name: /Connect/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(target).queryByRole('option', { name: /Open site/ })).toBeNull()
  })

  it('asks for the console inside the tab, not through the address a link could carry', async () => {
    await search('shop web')
    await screen.findByRole('group', { name: 'demo-shop / web' })
    await userEvent.keyboard('{Alt>}c{/Alt}')
    await waitFor(() => expect(takeConsoleRequest('demo-shop', 'web')).toBe(true))
    expect(takeConsoleRequest('demo-shop', 'web')).toBe(false)
    expect(window.location.search).not.toContain('section=console')
  })

  it('finds a page when no service answers to the words', async () => {
    await search('gateway')
    expect(await screen.findByRole('option', { name: /Gateway/ })).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('links to the sites waiting for a decision', async () => {
    await search('no decision')
    expect(await screen.findByRole('option', { name: 'Sites with no decision' })).toBeInTheDocument()
  })

  it('honours a request for the console once, for that service, and not for long', () => {
    requestConsole('demo-shop', 'web')
    expect(takeConsoleRequest('demo-shop', 'api')).toBe(false)
    expect(takeConsoleRequest('demo-shop', 'web')).toBe(false)

    requestConsole('demo-shop', 'web')
    const now = Date.now()
    const later = vi.spyOn(Date, 'now').mockReturnValue(now + 60_000)
    expect(takeConsoleRequest('demo-shop', 'web')).toBe(false)
    later.mockRestore()

    requestConsole('demo-shop', 'web')
    expect(takeConsoleRequest('demo-shop', 'web')).toBe(true)
  })

  it('searches without caring about accents', () => {
    expect(folded('Sites sem decisão')).toBe('sites sem decisao')
  })
})
