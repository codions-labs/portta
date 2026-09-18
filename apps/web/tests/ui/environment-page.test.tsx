import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Environment, ProjectGit } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment, makeOperable, makeStartable } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

const project = vi.fn()
const environmentGit = vi.fn()
const environmentLogs = vi.fn()
const projects = vi.fn()
const projectDetail = vi.fn()
const forgetEnvironment = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    environment: (name: string) => project(name),
    environmentGit: (name: string) => environmentGit(name),
    environmentLogs: (name: string, options: unknown) => environmentLogs(name, options),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    environmentAction: vi.fn().mockResolvedValue({
      ok: true,
      project: 'alpha',
      action: 'restart',
      requested: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      results: [],
    }),
    forgetEnvironment: (name: string) => forgetEnvironment(name),
    logs: vi.fn().mockResolvedValue({ lines: [], truncated: false }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue({ shares: [] }),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    serviceAction: vi.fn().mockResolvedValue({ ok: true }),
    environmentSettings: vi.fn().mockResolvedValue({}),
    projects: () => projects(),
    project: (slug: string) => projectDetail(slug),
    metricsCurrent: vi.fn().mockResolvedValue({ projects: [], collectorActive: false, stale: true }),
  },
}))

const { EnvironmentShell } = await import('@/components/environments/environment-shell')
const { EnvironmentOverview } = await import('@/components/environments/environment-overview')
const { LogsView } = await import('../../app/(panel)/environments/[name]/logs/logs-view.tsx')
const { EnvironmentSettingsView } = await import('../../app/(panel)/environments/[name]/settings/settings-view.tsx')

/**
 * A tab is a route now, so the test renders the shell around the body the route
 * would have rendered, and says which path it is on.
 */
function page(name: string, tab: 'overview' | 'logs' | 'settings' = 'overview', service: string | null = null) {
  navigation.pathname = tab === 'overview' ? `/environments/${name}` : `/environments/${name}/${tab}`
  navigation.search = service ? `service=${service}` : ''
  return (
    <EnvironmentShell name={name}>
      {tab === 'overview' ? <EnvironmentOverview name={name} /> : null}
      {tab === 'logs' ? <LogsView name={name} /> : null}
      {tab === 'settings' ? <EnvironmentSettingsView name={name} /> : null}
    </EnvironmentShell>
  )
}

const WEB_URL = {
  url: 'http://alpha-web.localhost',
  host: 'alpha-web.localhost',
  scope: 'local' as const,
  scheme: 'http' as const,
}

const alpha: Environment = {
  name: 'alpha',
  presence: 'live',
  integrated: true,
  workingDir: '/srv/dev/alpha',
  operable: makeOperable('/srv/dev/alpha'),
  startable: makeStartable(),
  namespace: null,
  group: null,
  repo: null,
  repoUrl: null,
  gitRoot: null,
  serviceCount: 2,
  runningCount: 2,
  healthyCount: 1,
  unhealthyCount: 0,
  networks: ['portta', 'alpha_default'],
  startedAt: 1_700_000_000,
  uptimeSeconds: 7200,
  scopes: ['local'],
  urls: [WEB_URL],
  services: [
    makeContainer({
      id: 'a-web',
      name: 'alpha-web-1',
      environment: 'alpha',
      service: 'web',
      ownership: 'integrated',
      traefikEnabled: true,
      kind: 'http',
      exposedPorts: [3000],
      uptimeSeconds: 7200,
      urls: [WEB_URL],
      mounts: [{ type: 'bind', name: null, source: '/srv/dev/alpha', destination: '/app', rw: true }],
      restartCount: 4,
    }),
    makeContainer({
      id: 'a-postgres',
      name: 'alpha-postgres-1',
      image: 'postgres:18.6-alpine',
      environment: 'alpha',
      service: 'postgres',
      ownership: 'integrated',
      kind: 'postgres',
      exposedPorts: [5432],
    }),
  ],
}

const gitScan: ProjectGit = {
  project: 'alpha',
  collected: true,
  collectedAt: 1_700_000_000,
  ageSeconds: 10,
  stale: false,
  staleAfterSeconds: 900,
  workingDir: '/srv/dev/alpha',
  git: {
    branch: 'fix/182-tcp-proxy',
    detached: false,
    head: { sha: 'abc1234def', shortSha: 'abc1234', subject: 'Fix the proxy', author: 'Someone', date: 1_700_000_000 },
    staged: 1,
    unstaged: 2,
    untracked: 0,
    unmerged: 0,
    dirty: true,
    upstream: 'origin/fix/182-tcp-proxy',
    ahead: 3,
    behind: 0,
    remote: 'origin',
  },
  remote: {
    url: 'git@github.com:acme/alpha.git',
    host: 'github.com',
    slug: 'acme/alpha',
    kind: 'github',
    repoUrl: 'https://github.com/acme/alpha',
  },
  links: {
    repo: 'https://github.com/acme/alpha',
    commit: 'https://github.com/acme/alpha/commit/abc1234def',
    branch: 'https://github.com/acme/alpha/tree/fix/182-tcp-proxy',
  },
  forge: {
    kind: 'github',
    collectedAt: 1_700_000_000,
    authenticated: true,
    reason: null,
    // Five, so the card's slice(0, 4) would have hidden one.
    pulls: [1, 2, 3, 4, 5].map((number) => ({
      number,
      title: `Pull ${number}`,
      state: 'OPEN',
      draft: false,
      reviewDecision: null,
      checks: null,
      url: `https://github.com/acme/alpha/pull/${number}`,
      headRefName: `feat/${number}`,
    })),
  },
  reason: null,
  refreshCommand: 'portta repos scan --environment alpha',
}

beforeEach(() => {
  project.mockReset().mockResolvedValue(alpha)
  environmentGit.mockReset().mockResolvedValue(gitScan)
  environmentLogs.mockReset().mockResolvedValue({
    project: 'alpha',
    truncated: false,
    ordered: true,
    sources: [
      {
        containerId: 'a-web',
        service: 'web',
        name: 'alpha-web-1',
        state: 'running',
        lineCount: 1,
        truncated: false,
        error: null,
      },
      {
        containerId: 'a-postgres',
        service: 'postgres',
        name: 'alpha-postgres-1',
        state: 'running',
        lineCount: 1,
        truncated: false,
        error: null,
      },
    ],
    lines: [
      { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'web up', service: 'web' },
      { stream: 'stdout', timestamp: '2026-01-01T10:00:02Z', text: 'postgres ready', service: 'postgres' },
    ],
  })
  forgetEnvironment.mockReset().mockResolvedValue({ ok: true, forgotten: 'alpha' })
  projects.mockReset().mockResolvedValue([{ slug: 'shop', name: 'Shop' }])
  projectDetail.mockReset().mockResolvedValue({
    slug: 'shop',
    name: 'Shop',
    repositories: [{ id: 'r1', name: 'api', environments: ['alpha'] }],
    environments: [{ environment: 'alpha' }],
  })
  navigation.push.mockReset()
  navigation.pathname = '/environments/alpha'
  navigation.search = ''
})

describe('Environment page', () => {
  it('reads every service of the environment on the Logs tab', async () => {
    renderWithQuery(page('alpha', 'logs'))
    expect(await screen.findByText('web up')).toBeInTheDocument()
    expect(screen.getByText('postgres ready')).toBeInTheDocument()
    expect(environmentLogs).toHaveBeenCalledWith('alpha', { tail: 200, service: null })
    expect(screen.getByLabelText('Service')).toHaveValue('')
  })

  it('reads one service when the URL names it', async () => {
    renderWithQuery(page('alpha', 'logs', 'postgres'))
    await screen.findByText('postgres ready')
    expect(environmentLogs).toHaveBeenCalledWith('alpha', { tail: 200, service: 'postgres' })
    expect(screen.getByLabelText('Service')).toHaveValue('postgres')
  })

  describe('when remembered', () => {
    const remembered = makeEnvironment({ presence: 'remembered', workingDir: '/srv/dev/alpha' })

    beforeEach(() => {
      project.mockResolvedValue(remembered)
      environmentGit.mockRejectedValue(new ApiError(404, 'no scan'))
    })

    it('says it is not running and hides rebuild and remove', async () => {
      renderWithQuery(page('alpha', 'overview'))
      await screen.findByRole('heading', { name: 'alpha' })
      expect(screen.getByText('Not running')).toBeInTheDocument()
      expect(screen.queryByText(/services running/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Forget' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove, keep data' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open / Test' })).toBeNull()
      expect(
        await screen.findByText('Containers were removed. Start recreates them through the runner.'),
      ).toBeInTheDocument()
    })

    it('does not read logs that no container can write', async () => {
      renderWithQuery(page('alpha', 'logs'))
      expect(
        await screen.findByText('Containers were removed. Start recreates them through the runner.'),
      ).toBeInTheDocument()
      expect(environmentLogs).not.toHaveBeenCalled()
    })

    it('goes back to the list once forgotten', async () => {
      renderWithQuery(page('alpha', 'overview'))
      await userEvent.click(await screen.findByRole('button', { name: 'Forget' }))
      await screen.findByRole('dialog', { name: 'Forget this environment?' })
      await userEvent.click(screen.getAllByRole('button', { name: 'Forget' }).at(-1)!)
      await waitFor(() => expect(forgetEnvironment).toHaveBeenCalledWith('alpha'))
      await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/environments'))
    })
  })
})

describe('what a role is shown', () => {
  const viewer = principal({ role: 'viewer', permissions: ['environment:read', 'service:read', 'logs:read'] })

  // A viewer reads. Nothing on the page offers to start, stop or forget
  // anything, and the page itself still answers.
  it('offers a viewer no operation and no way to forget', async () => {
    renderWithQuery(page('alpha', 'overview'), undefined, viewer)
    await screen.findByRole('heading', { name: 'alpha' })
    expect(screen.queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })
})
