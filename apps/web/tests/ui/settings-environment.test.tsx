import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { principal, renderWithQuery } from './render.tsx'

const environmentReport = vi.fn()
const hostSecurityReport = vi.fn()
vi.mock('@/lib/api', () => ({
  api: {
    environmentReport: () => environmentReport(),
    hostSecurityReport: () => hostSecurityReport(),
  },
}))

const { HostHealthView: EnvironmentView } = await import('../../app/(panel)/host/health-view.tsx')

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

describe('Environment settings', () => {
  it('shows the host readiness and the security findings it collected', async () => {
    renderWithQuery(<EnvironmentView />, undefined, principal({ permissions: ['metrics:read'] }))
    expect(await screen.findByText('Docker')).toBeInTheDocument()
    expect(await screen.findByText('Host firewall')).toBeInTheDocument()
  })
})
