import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hostGroupItems, SETTINGS_SECTIONS, visibleSections } from '@/components/settings/sections'
import { SettingsNav } from '@/components/settings/settings-nav'
import { SettingsSearch } from '@/components/settings/settings-search'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'

const apiConfig = vi.fn()

vi.mock('@/lib/api/index', async (original) => {
  const actual = await original<typeof import('@/lib/api/index')>()
  return { ...actual, api: { ...actual.api, config: () => apiConfig() } }
})

const OWNER = SETTINGS_SECTIONS.flatMap((section) => (section.permission ? [section.permission] : []))

describe('which Settings sections somebody has', () => {
  it('leaves a developer their own tokens and their own account', () => {
    const ids = visibleSections({
      permissions: ['token:read', 'project:read'],
      signsPeopleIn: true,
    }).map((section) => section.id)
    expect(ids).toEqual(['tokens', 'security'])
  })

  it('hides everything about accounts when the panel signs nobody in', () => {
    const ids = visibleSections({ permissions: OWNER, signsPeopleIn: false }).map((section) => section.id)
    expect(ids).toEqual(['general'])
  })
})

describe('the Settings rail', () => {
  it('offers only the sections this person has, and marks the one they are on', () => {
    navigation.pathname = '/settings/tokens'
    renderWithQuery(
      <SettingsNav signsPeopleIn />,
      undefined,
      principal({ role: 'developer', permissions: ['token:read'] }),
    )
    expect(screen.getByRole('link', { name: 'API tokens' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute('href', '/settings/security')
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Addresses' })).toBeNull()
  })

  it('lists this host and people apart, with certificates and DNS as one line', () => {
    navigation.pathname = '/settings/general/dns'
    renderWithQuery(
      <SettingsNav signsPeopleIn />,
      undefined,
      principal({ permissions: ['settings:read', 'user:list'] }),
    )
    expect(screen.getByText('This server')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Certificates and DNS' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/settings/users')
  })

  it('stays out of the way when there is only one thing to open', () => {
    navigation.pathname = '/settings/tokens'
    const { container } = renderWithQuery(
      <SettingsNav signsPeopleIn={false} />,
      undefined,
      principal({ permissions: ['token:read'] }),
    )
    expect(container.querySelector('nav')).toBeNull()
  })
})

describe('the Settings search', () => {
  const config = {
    groups: ['TLS', 'DNS', 'Panel'],
    fields: [
      { key: 'ACME_EMAIL', group: 'TLS', label: 'ACME contact', help: 'For Let’s Encrypt.' },
      { key: 'PORTTA_WEB_HOST', group: 'Panel', label: 'Hidden on purpose', help: '' },
    ],
  }

  async function search(text: string) {
    renderWithQuery(
      <SettingsSearch signsPeopleIn />,
      undefined,
      principal({ permissions: ['settings:read', 'user:list'] }),
    )
    await waitFor(() => expect(apiConfig).toHaveBeenCalled())
    await userEvent.type(await screen.findByLabelText('Search settings'), text, { delay: null })
  }

  beforeEach(() => {
    apiConfig.mockReset().mockResolvedValue(config)
  })

  it('opens a setting found by what it does, and marks which one', async () => {
    await search('encrypt')
    expect(await screen.findByRole('link', { name: /Encrypt contact/ })).toHaveAttribute(
      'href',
      '/settings/general/tls?field=ACME_EMAIL',
    )
  })

  it('finds its variable, with or without accents', async () => {
    await search('acme_email')
    expect(await screen.findByRole('link', { name: /Encrypt contact/ })).toBeInTheDocument()
  })

  it('finds a section by name', async () => {
    await search('users')
    expect(await screen.findByRole('link', { name: /Users/ })).toHaveAttribute('href', '/settings/users')
  })

  it('does not offer what no section shows', async () => {
    await search('on purpose')
    expect(await screen.findByText('No setting found')).toBeInTheDocument()
  })
})

describe('hostGroupItems', () => {
  it('keeps a group the rail does not know about on a line of its own', () => {
    const items = hostGroupItems(['Panel', 'TLS', 'DNS', 'New one'])
    expect(items.map((item) => item.id)).toEqual(['tls', 'panel', 'new-one'])
    expect(items[0]?.groups).toEqual(['TLS', 'DNS'])
    expect(items[0]?.slugs).toEqual(['tls', 'dns'])
  })
})
