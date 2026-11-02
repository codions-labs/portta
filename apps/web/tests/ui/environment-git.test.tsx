import { screen, within } from '@testing-library/react'
import type { GitState } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const metricsCurrent = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: { metricsCurrent: () => metricsCurrent() },
}))

const { EnvironmentGit, gitVerdict, startedBeforeCommit } = await import('@/components/environments/environment-git')

const NOW = 1_800_000_000

function git(overrides: Partial<GitState> = {}): GitState {
  return {
    path: '/home/ada/projects/demo-shop',
    branch: 'develop',
    detached: false,
    upstream: 'origin/develop',
    ahead: 0,
    behind: 0,
    head: { sha: 'a41f2c9', subject: 'fix(cart): valida o SKU', author: 'Ada Lovelace', at: NOW - 7200 },
    changed: 0,
    untracked: 0,
    files: [],
    lastChangeAt: NOW - 7200,
    collectedAt: NOW - 60,
    ...overrides,
  }
}

const environment = makeEnvironment({ name: 'demo-shop' })

function serve(state: GitState | undefined) {
  metricsCurrent.mockResolvedValue({
    projects: [{ composeProject: 'demo-shop', containers: [], ...(state ? { git: state } : {}) }],
    collectorActive: true,
    stale: false,
  })
}

beforeEach(() => metricsCurrent.mockReset())

describe('what the code says about itself', () => {
  it('names the worst true thing first', () => {
    expect(gitVerdict(git({ changed: 1 }))).toBe('changed')
    expect(gitVerdict(git({ untracked: 2, ahead: 3 }))).toBe('changed')
    expect(gitVerdict(git({ ahead: 2 }))).toBe('unpushed')
    expect(gitVerdict(git({ behind: 1 }))).toBe('behind')
    expect(gitVerdict(git({ upstream: null, ahead: null, behind: null }))).toBe('noUpstream')
    expect(gitVerdict(git())).toBe('clean')
  })

  it('knows a container that started before the last commit', () => {
    const young = { services: [makeContainer({ state: 'running', uptimeSeconds: 600 })] }
    const old = { services: [makeContainer({ state: 'running', uptimeSeconds: 86_400 })] }
    expect(startedBeforeCommit(old, git(), NOW)).toBe(true)
    expect(startedBeforeCommit(young, git(), NOW)).toBe(false)
    expect(startedBeforeCommit(old, git({ head: null }), NOW)).toBe(false)
  })
})

describe('the Code card', () => {
  it('shows the branch, the last commit and what is not committed or pushed', async () => {
    serve(
      git({
        changed: 2,
        untracked: 1,
        ahead: 2,
        files: [
          { path: 'src/cart/validate.ts', status: 'M' },
          { path: 'notes.md', status: 'U' },
        ],
      }),
    )
    renderWithQuery(<EnvironmentGit environment={environment} />)
    const card = await screen.findByText('Code')
    expect(card).toBeInTheDocument()
    expect(screen.getByText('Has changes')).toBeInTheDocument()
    expect(screen.getByText('develop')).toBeInTheDocument()
    expect(screen.getByText(/fix\(cart\): valida o SKU/)).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
    expect(screen.getByText('2 commits to origin/develop')).toBeInTheDocument()
    const files = screen.getByRole('list', { name: 'Changed files' })
    expect(within(files).getByText('src/cart/validate.ts')).toBeInTheDocument()
    expect(within(files).getByText('New')).toBeInTheDocument()
    expect(screen.getByText(/without asking GitHub/)).toBeInTheDocument()
  })

  it('says so when everything is pushed, and has no file list', async () => {
    serve(git())
    renderWithQuery(<EnvironmentGit environment={environment} />)
    expect(await screen.findByText('All pushed')).toBeInTheDocument()
    expect(screen.getByText('All pushed to origin/develop')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Changed files' })).toBeNull()
  })

  it('warns that what is running may predate the last commit', async () => {
    serve(git())
    const old = makeEnvironment({
      name: 'demo-shop',
      services: [makeContainer({ state: 'running', uptimeSeconds: 10 * 365 * 86_400 })],
    })
    renderWithQuery(<EnvironmentGit environment={old} />)
    expect(await screen.findByText(/started before the last commit/)).toBeInTheDocument()
  })

  it('is not there for an environment the collector read no repository for', async () => {
    serve(undefined)
    const { container } = renderWithQuery(<EnvironmentGit environment={environment} />)
    await vi.waitFor(() => expect(metricsCurrent).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
