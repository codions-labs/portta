import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'

const exposure = vi.fn()
const protectService = vi.fn()
const openService = vi.fn()
const closeService = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class extends Error {},
  api: {
    exposure: () => exposure(),
    protectService: (...args: unknown[]) => protectService(...args),
    openService: (...args: unknown[]) => openService(...args),
    closeService: (...args: unknown[]) => closeService(...args),
  },
}))

const { ExposurePanel } = await import('@/components/exposure-panel')
const { canonicalHost } = await import('@/lib/host-access')

const container = makeContainer({
  id: 'c1',
  labels: {
    'traefik.enable': 'true',
    'traefik.http.routers.web.rule': 'Host(`shop-web.example.test`)',
    'traefik.http.routers.web.middlewares': 'portta-forward-auth@file',
  },
  urls: [{ url: 'https://shop-web.example.test', host: 'shop-web.example.test', scope: 'public', scheme: 'https' }],
})

beforeEach(() => {
  exposure.mockReset().mockResolvedValue({ enforced: true, entries: [], openRouters: { count: 0, names: [] } })
  protectService.mockReset().mockResolvedValue({ ok: true, entry: null, password: 'abcde-fghij', note: '' })
  openService.mockReset().mockResolvedValue({ ok: true, entry: null, note: '' })
  closeService.mockReset().mockResolvedValue({ ok: true, entry: null, note: '' })
})

describe('the hostname the panel matches on', () => {
  it('canonicalizes like the registry: case, trailing dot, default port and IDN', () => {
    expect(canonicalHost('Shop-Web.Example.TEST.')).toBe('shop-web.example.test')
    expect(canonicalHost('shop-web.example.test:80')).toBe('shop-web.example.test')
    expect(canonicalHost('bücher.example.test')).toBe('xn--bcher-kva.example.test')
  })
})

describe('who may open a service', () => {
  it('does not present stored credentials as protection when its router does not enforce them', async () => {
    exposure.mockResolvedValue({
      enforced: false,
      openRouters: { count: 0, names: [] },
      entries: [
        {
          host: 'shop-web.example.test',
          mode: 'protected',
          user: 'reviewer',
          project: null,
          service: null,
          label: 'web',
        },
      ],
    })
    renderWithQuery(<ExposurePanel container={{ ...container, labels: { 'traefik.enable': 'true' } }} />)
    expect(await screen.findByText('no login')).toBeInTheDocument()
    expect(screen.queryByText('protected')).toBeNull()
    expect(await screen.findByRole('button', { name: 'New password' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Open to everybody' })).toBeNull()
    expect(protectService).not.toHaveBeenCalled()
  })

  it('says a hostname nobody decided about is closed, and protects it with a password shown once', async () => {
    renderWithQuery(<ExposurePanel container={container} />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Nobody/ })).toBeChecked())
    await userEvent.click(screen.getByRole('radio', { name: /Whoever has the password/ }))
    expect(await screen.findByText('abcde-fghij')).toBeInTheDocument()
    expect(protectService).toHaveBeenCalledWith('c1')
  })

  it('shows a protected host and offers a new password, opening and closing', async () => {
    exposure.mockResolvedValue({
      enforced: true,
      openRouters: { count: 0, names: [] },
      entries: [
        {
          host: 'shop-web.example.test',
          mode: 'protected',
          user: 'reviewer',
          project: null,
          service: null,
          label: 'web',
        },
      ],
    })
    renderWithQuery(<ExposurePanel container={container} />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Whoever has the password/ })).toBeChecked())
    expect(screen.getByRole('button', { name: 'New password' })).toBeEnabled()
    await userEvent.click(screen.getByRole('radio', { name: /Anybody/ }))
    // Opening to everybody asks first.
    expect(openService).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Open to everybody' }))
    await waitFor(() => expect(openService).toHaveBeenCalledWith('c1'))
    await userEvent.click(screen.getByRole('radio', { name: /Nobody/ }))
    await waitFor(() => expect(closeService).toHaveBeenCalledWith('c1'))
  })

  it('offers no control to somebody who may not decide', async () => {
    renderWithQuery(<ExposurePanel container={container} />, undefined, principal({ permissions: ['service:read'] }))
    expect(await screen.findByText('closed')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Whoever has the password/ })).toBeNull()
  })
})
