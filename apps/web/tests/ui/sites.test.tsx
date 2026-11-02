import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const environments = vi.fn()
const exposure = vi.fn()

class ApiError extends Error {}

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    environments: () => environments(),
    exposure: () => exposure(),
    shares: () => Promise.resolve({ shares: [] }),
  },
}))

const { SitesView } = await import('../../app/(panel)/access/sites-view.tsx')

const GATED = {
  'traefik.enable': 'true',
  'traefik.http.routers.shop.middlewares': 'portta-forward-auth@file',
}
const UNGATED = { 'traefik.enable': 'true', 'traefik.http.routers.open.rule': 'Host(`open.example.test`)' }

function route(host: string) {
  return { url: `https://${host}`, host, scope: 'public' as const, scheme: 'https' as const }
}

const live = makeEnvironment({
  name: 'shop',
  services: [
    makeContainer({
      id: 'gated',
      name: 'shop-web-1',
      service: 'web',
      labels: GATED,
      urls: [route('shop.example.test')],
    }),
    makeContainer({
      id: 'open',
      name: 'shop-api-1',
      service: 'api',
      labels: UNGATED,
      urls: [route('open.example.test')],
    }),
  ],
})

function row(host: string) {
  const line = screen.getByRole('link', { name: host }).closest('li')
  if (!line) throw new Error(`no row for ${host}`)
  return within(line)
}

beforeEach(() => {
  environments.mockReset().mockResolvedValue([live])
  exposure.mockReset().mockResolvedValue({ enforced: true, entries: [], openRouters: { count: 0, names: [] } })
})

describe('Sites', () => {
  it('does not call a route without the gate closed', async () => {
    renderWithQuery(<SitesView />)
    await screen.findByRole('link', { name: 'open.example.test' })
    expect(row('open.example.test').getByText('Open, no login')).toBeInTheDocument()
    expect(row('open.example.test').queryByRole('radiogroup')).toBeNull()
    expect(row('shop.example.test').queryByText('Open, no login')).toBeNull()
    expect(screen.getByRole('button', { name: /No login, open 1/ })).toBeInTheDocument()
  })

  it('reads the labels even when the registry holds a decision for that address', async () => {
    exposure.mockResolvedValue({
      enforced: true,
      openRouters: { count: 0, names: [] },
      entries: [{ host: 'open.example.test', mode: 'protected', user: 'x', project: null, service: null, label: 'x' }],
    })
    renderWithQuery(<SitesView />)
    await screen.findByRole('link', { name: 'open.example.test' })
    expect(row('open.example.test').getByText('Open, no login')).toBeInTheDocument()
  })

  it('calls an address open when any replica behind it lacks the gate', async () => {
    environments.mockResolvedValue([
      makeEnvironment({
        name: 'shop',
        services: [
          makeContainer({ id: 'one', name: 'shop-web-1', labels: GATED, urls: [route('shop.example.test')] }),
          makeContainer({ id: 'two', name: 'shop-web-2', labels: UNGATED, urls: [route('shop.example.test')] }),
        ],
      }),
    ])
    renderWithQuery(<SitesView />)
    const rows = await screen.findAllByRole('link', { name: 'shop.example.test' })
    for (const link of rows) {
      const line = link.closest('li')
      if (!line) throw new Error('no row')
      expect(within(line).getByText('Open, no login')).toBeInTheDocument()
    }
    expect(rows).toHaveLength(2)
  })

  it('calls no address safe while a router is open on names nobody can list', async () => {
    environments.mockResolvedValue([
      makeEnvironment({
        name: 'shop',
        services: [makeContainer({ id: 'gated', labels: GATED, urls: [route('shop.example.test')] })],
      }),
    ])
    exposure.mockResolvedValue({
      enforced: true,
      entries: [{ host: 'shop.example.test', mode: 'protected', user: 'x', project: null, service: null, label: 'x' }],
      openRouters: { count: 1, names: ['loose-1'] },
    })
    renderWithQuery(<SitesView />)
    await screen.findByRole('link', { name: 'shop.example.test' })
    expect(row('shop.example.test').getByText('Open, no login')).toBeInTheDocument()
    expect(screen.getByText(/1 service answers with no login on addresses/)).toBeInTheDocument()
    expect(screen.getByText('loose-1')).toBeInTheDocument()
  })

  it('warns somebody who may not see the name of what is open', async () => {
    exposure.mockResolvedValue({ enforced: true, entries: [], openRouters: { count: 2, names: [] } })
    renderWithQuery(<SitesView />)
    await screen.findByRole('link', { name: 'shop.example.test' })
    expect(screen.getByText(/2 services answer with no login on addresses/)).toBeInTheDocument()
  })

  it('says nothing about access until the registry answers', async () => {
    exposure.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<SitesView />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('No login')).toBeNull()
  })
})
