import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ConfigField, ProjectDomain } from 'portta-contracts'
import { describe, expect, it, vi } from 'vitest'
import { ProjectAccessSettings } from '@/components/settings/project-access-settings'
import { renderWithQuery } from './render.tsx'

function field(key: string, effectiveValue: string, kind: ConfigField['kind'] = 'string'): ConfigField {
  return {
    key,
    value: null,
    runtimeValue: effectiveValue,
    effectiveValue,
    defaultValue: effectiveValue,
    valueSource: 'default',
    secret: key === 'TS_AUTHKEY',
    isSet: false,
    pending: false,
    kind,
    group: 'Project access',
    label: key,
    help: '',
    restartRequired: true,
  }
}

const localDomain: ProjectDomain = {
  mode: 'local',
  domain: 'localhost',
  publicIp: null,
  provider: 'sslip.io',
  examples: ['loja-web.localhost'],
  problem: null,
  reachable: true,
  advice: null,
}

const fields = [
  field('PORTTA_PROFILE', 'local', 'choice'),
  field('PORTTA_BIND_ADDRESS', '127.0.0.1'),
  field('PUBLIC_ENABLED', 'false', 'boolean'),
  field('PUBLIC_DOMAIN', ''),
  field('TAILSCALE_ENABLED', 'false', 'boolean'),
  field('TAILSCALE_HOSTNAME', 'portta'),
  field('TS_AUTHKEY', ''),
  field('PRIVATE_DOMAIN', ''),
  field('PORTTA_HTTP_PORT', '80', 'number'),
  field('PORTTA_HTTPS_PORT', '443', 'number'),
  field('PORTTA_LOG_LEVEL', 'INFO', 'choice'),
  field('PORTTA_ACCESS_LOG', 'false', 'boolean'),
]

function renderAccess(overrides: Record<string, string> = {}) {
  const values = Object.fromEntries(fields.map((entry) => [entry.key, entry.effectiveValue ?? '']))
  const onPatch = vi.fn()
  renderWithQuery(
    <ProjectAccessSettings
      fields={fields}
      values={{ ...values, ...overrides }}
      domain={localDomain}
      valueFor={(entry) => values[entry.key] ?? ''}
      onChange={vi.fn()}
      onPatch={onPatch}
    />,
  )
  return onPatch
}

describe('project access settings', () => {
  it('turns public access into one coherent configuration change', async () => {
    const onPatch = renderAccess()
    await userEvent.click(screen.getByRole('radio', { name: /From the internet/ }))
    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        PORTTA_PROFILE: 'remote-public',
        PORTTA_BIND_ADDRESS: '0.0.0.0',
        PUBLIC_ENABLED: 'true',
        TAILSCALE_ENABLED: 'false',
      }),
    )
  })

  it('does not offer localhost as a public domain', () => {
    renderAccess({ PORTTA_PROFILE: 'remote-public', PUBLIC_ENABLED: 'true' })
    expect(screen.getByRole('radio', { name: /configured base domain/ })).toBeDisabled()
    expect(screen.getByLabelText('Other public domain')).toHaveValue('')
    expect(screen.getByText(/localhost cannot work over the internet/)).toBeInTheDocument()
  })
})
