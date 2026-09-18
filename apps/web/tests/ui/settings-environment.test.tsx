import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { principal, renderWithQuery } from './render.tsx'

const environmentReport = vi.fn()
const hostSecurityReport = vi.fn()
const sshKeys = vi.fn()
const generateSshKey = vi.fn()
vi.mock('@/lib/api', () => ({
  api: {
    environmentReport: () => environmentReport(),
    hostSecurityReport: () => hostSecurityReport(),
    sshKeys: () => sshKeys(),
    generateSshKey: (body: unknown) => generateSshKey(body),
    importSshKey: vi.fn(),
    removeSshKey: vi.fn(),
    testSshKey: vi.fn(),
  },
}))

const { EnvironmentView } = await import('../../app/(panel)/settings/environment/environment-view.tsx')

beforeEach(() =>
  environmentReport.mockReset().mockResolvedValue({
    version: 1,
    collectedAt: Math.floor(Date.now() / 1000) - 20,
    durationMs: 120,
    ageSeconds: 20,
    stale: false,
    summary: { passed: 1, recommendations: 1, problems: 0, information: 1, ok: true },
    checks: [
      {
        id: 'runtime.docker',
        status: 'pass',
        title: 'Docker',
        detail: '27.3.1',
        fix: '',
        category: 'infrastructure',
        tool: { installed: true, version: '27.3.1', path: '/usr/bin/docker', minimum: '24' },
        details: [{ status: 'pass', text: 'daemon is reachable and accessible to this user' }],
      },
      {
        id: 'tools.gh',
        status: 'warn',
        title: 'GitHub CLI',
        detail: 'installed but not authenticated',
        fix: 'gh auth login',
        category: 'development',
      },
      {
        id: 'agents.gemini',
        status: 'info',
        title: 'Gemini CLI',
        detail: 'not installed (optional)',
        fix: '',
        category: 'agents',
      },
    ],
  }),
)

beforeEach(() =>
  hostSecurityReport.mockReset().mockResolvedValue({
    version: 1,
    collectedAt: Math.floor(Date.now() / 1000) - 20,
    durationMs: 20,
    ageSeconds: 20,
    stale: false,
    summary: { passed: 1, recommendations: 1, problems: 0, information: 1, ok: true },
    checks: [
      {
        id: 'security.firewall',
        status: 'warn',
        title: 'Host firewall',
        detail: 'ufw: inactive',
        fix: '',
        category: 'security',
        rationale: "Docker's published ports can bypass UFW.",
        docs: 'docs/product/guides/firewall.md',
      },
    ],
  }),
)

beforeEach(() => {
  vi.mocked(navigator.clipboard.writeText).mockClear()
  sshKeys.mockReset().mockResolvedValue({
    keys: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'deploy',
        description: null,
        algorithm: 'ed25519',
        bits: null,
        fingerprint: 'SHA256:public-only',
        publicKey: 'ssh-ed25519 AAAA public',
        origin: 'generated',
        createdAt: Math.floor(Date.now() / 1000),
      },
    ],
  })
  generateSshKey.mockReset().mockResolvedValue({})
})

describe('Environment settings', () => {
  it('shows public metadata to readers and key creation only to managers', async () => {
    const reader = renderWithQuery(
      <EnvironmentView />,
      undefined,
      principal({ permissions: ['metrics:read', 'ssh:read'] }),
    )
    expect(await screen.findByText('deploy')).toBeInTheDocument()
    expect(screen.getByText('SHA256:public-only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate key' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Show public key'))
    await userEvent.click(screen.getByRole('button', { name: 'Copy public key' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ssh-ed25519 AAAA public')
    reader.unmount()

    renderWithQuery(
      <EnvironmentView />,
      undefined,
      principal({ permissions: ['metrics:read', 'ssh:read', 'ssh:manage'] }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Generate key' }))
    expect(await screen.findByText('Generate an SSH key')).toBeInTheDocument()
    await userEvent.type(await screen.findByLabelText(/Name/), 'release', { delay: null })
    await userEvent.click(screen.getAllByRole('button', { name: 'Generate key' }).at(-1)!)
    expect(generateSshKey).toHaveBeenCalledWith({ name: 'release', description: undefined, algorithm: 'ed25519' })
  })
})
