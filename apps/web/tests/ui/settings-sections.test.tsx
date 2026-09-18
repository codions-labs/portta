import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTIONS, visibleSections } from '@/components/settings/sections'
import { SettingsSections } from '@/components/settings/settings-sections'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'

const OWNER = SETTINGS_SECTIONS.flatMap((section) => (section.permission ? [section.permission] : []))

describe('which Settings sections somebody has', () => {
  it('leaves a developer their own tokens and their own account', () => {
    const ids = visibleSections({
      permissions: ['token:read', 'issue:read', 'project:read'],
      signsPeopleIn: true,
    }).map((section) => section.id)
    expect(ids).toEqual(['tokens', 'security', 'integrations'])
  })

  it('hides everything about accounts when the panel signs nobody in', () => {
    const ids = visibleSections({ permissions: OWNER, signsPeopleIn: false }).map((section) => section.id)
    expect(ids).toEqual(['general', 'environment', 'integrations'])
  })
})

describe('the Settings rail', () => {
  it('offers only the sections this person has, and marks the one they are on', () => {
    navigation.pathname = '/settings/tokens'
    renderWithQuery(
      <SettingsSections signsPeopleIn />,
      undefined,
      principal({ role: 'developer', permissions: ['token:read', 'issue:read'] }),
    )
    expect(screen.getByRole('link', { name: 'API tokens' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute('href', '/settings/security')
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'General' })).toBeNull()
  })
})
