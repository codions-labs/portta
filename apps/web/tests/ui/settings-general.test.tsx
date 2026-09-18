import { screen, waitFor } from '@testing-library/react'
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

const config = vi.fn()
const patchConfig = vi.fn()
const agentPermissions = vi.fn()
const setAgentPermissions = vi.fn()
const github = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    config: () => config(),
    patchConfig: (...args: unknown[]) => patchConfig(...args),
    agentPermissions: () => agentPermissions(),
    setAgentPermissions: (...args: unknown[]) => setAgentPermissions(...args),
    github: () => github(),
  },
}))

const { GeneralView } = await import('../../app/(panel)/settings/general/[[...group]]/general-view.tsx')
const { AgentPermissionsCard } = await import('../../components/settings/agent-permissions-card.tsx')

function field(overrides: Record<string, unknown> = {}) {
  return {
    key: 'PORTTA_WEB_PORT',
    value: null,
    runtimeValue: '8081',
    effectiveValue: '8081',
    defaultValue: '8081',
    valueSource: 'default',
    secret: false,
    isSet: false,
    pending: false,
    kind: 'number',
    group: 'Panel',
    label: 'Port',
    help: 'Where the panel listens.',
    restartRequired: true,
    ...overrides,
  }
}

beforeEach(() => {
  config.mockReset().mockResolvedValue({
    fields: [
      field(),
      field({
        key: 'PORTTA_WEB_BIND_ADDRESS',
        value: null,
        runtimeValue: '127.0.0.1',
        effectiveValue: '127.0.0.1',
        defaultValue: '127.0.0.1',
        label: 'Bind',
        kind: 'string',
      }),
      field({
        key: 'PORTTA_WEB_EXPOSE',
        value: null,
        runtimeValue: 'local',
        effectiveValue: 'local',
        defaultValue: 'local',
        label: 'How the panel is reached',
        kind: 'choice',
        choices: ['local', 'tailscale', 'public', 'vpn', 'domain'],
      }),
      field({ key: 'GITHUB_TOKEN', group: 'GitHub', secret: true, value: null, defaultValue: null }),
    ],
    projectDomain: {
      mode: 'local',
      domain: 'localhost',
      publicIp: null,
      provider: 'sslip.io',
      examples: ['loja-web.localhost'],
      problem: null,
      reachable: true,
      advice: null,
    },
    envFile: { path: '/srv/portta/.env', exists: true, writable: true },
    pendingRestart: false,
    applyCommand: 'portta apply',
    groups: ['Panel', 'GitHub'],
  })
  patchConfig
    .mockReset()
    .mockResolvedValue({ ok: true, saved: [], pendingRestart: false, applyCommand: 'portta apply', view: null })
  agentPermissions.mockReset().mockResolvedValue({
    permissions: ['task:read', 'task:write'],
    defaults: ['task:read', 'task:write'],
    available: ['task:read', 'task:write', 'task:delete', 'settings:read'],
    configured: false,
  })
  setAgentPermissions.mockReset().mockResolvedValue({
    permissions: ['task:read'],
    defaults: ['task:read', 'task:write'],
    available: ['task:read', 'task:write', 'task:delete', 'settings:read'],
    configured: true,
  })
})

describe('the General settings', () => {
  it('keeps the authentication origin in sync when the panel port changes', async () => {
    renderWithQuery(<GeneralView group="panel" />, undefined, principal())
    const port = await screen.findByLabelText('Port')
    await userEvent.clear(port)
    await userEvent.type(port, '9090', { delay: null })
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    await waitFor(() =>
      expect(patchConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          PORTTA_WEB_PORT: '9090',
          PORTTA_PANEL_URL: 'http://127.0.0.1:9090',
        }),
      ),
    )
  })

  it('hides Save from somebody who may only read the settings', async () => {
    const readOnly = principal({ permissions: ['settings:read'] })
    renderWithQuery(<GeneralView group="panel" />, undefined, readOnly)
    await screen.findByRole('link', { name: 'Panel' })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('what a local agent may do', () => {
  it('saves the list somebody ticked, and never a name the panel does not know', async () => {
    renderWithQuery(<AgentPermissionsCard editable />, undefined, principal())
    await screen.findByText('Using the default')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'task:write' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(setAgentPermissions).toHaveBeenCalledWith(['task:read'])
    expect(await screen.findByRole('button', { name: 'Restore the default' })).toBeInTheDocument()
  })

  it('is inert for somebody who may only read', async () => {
    renderWithQuery(<AgentPermissionsCard editable={false} />, undefined, principal())
    await screen.findByRole('checkbox', { name: 'task:read' })
    expect(screen.getByRole('checkbox', { name: 'task:read' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
