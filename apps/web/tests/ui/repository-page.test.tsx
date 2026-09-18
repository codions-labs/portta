import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRepository, makeRepositoryGit } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const repository = vi.fn()
const repositoryGit = vi.fn()
const repositoryCommits = vi.fn()
const repositoryInstructions = vi.fn()
const repositoryEnvironments = vi.fn()
const deleteRepository = vi.fn()
const project = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    repository: (id: string) => repository(id),
    repositoryGit: (id: string) => repositoryGit(id),
    repositoryCommits: (id: string) => repositoryCommits(id),
    repositoryInstructions: (id: string) => repositoryInstructions(id),
    repositoryEnvironments: (id: string) => repositoryEnvironments(id),
    deleteRepository: (id: string) => deleteRepository(id),
    project: (slug: string) => project(slug),
  },
}))

const { RepositoryPageView } = await import('@/components/entities/repository-page-view')

/** The page's server half read the repository and the project it belongs to. */
function view(tab: string | null = null, overrides: { repository?: unknown } = {}) {
  return (
    <RepositoryPageView
      slug="shop"
      projectId="1"
      projectName="Shop"
      initialRepository={(overrides.repository ?? makeRepository()) as never}
      tab={tab}
    />
  )
}

beforeEach(() => {
  const git = makeRepositoryGit()
  repository.mockReset().mockResolvedValue(makeRepository())
  repositoryGit.mockReset().mockResolvedValue(git)
  repositoryCommits.mockReset().mockResolvedValue({ commits: git.commits, collectedAt: git.collectedAt, stale: false })
  repositoryInstructions
    .mockReset()
    .mockResolvedValue({ instructions: git.instructions, collectedAt: git.collectedAt, stale: false })
  repositoryEnvironments.mockReset().mockResolvedValue([
    {
      environment: 'alpha',
      running: true,
      serviceCount: 2,
      runningCount: 2,
      unhealthyCount: 0,
      urls: [{ url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' }],
    },
  ])
  deleteRepository.mockReset().mockResolvedValue({ ok: true, removed: 'r1', note: '' })
  project.mockReset().mockResolvedValue({ slug: 'shop', name: 'Shop', repositories: [], environments: [] })
  navigation.push.mockReset()
})

describe('the Repository page', () => {
  it('unregisters after a confirmation and goes back to the project', async () => {
    renderWithQuery(view())
    await screen.findByRole('heading', { name: 'api' })
    await userEvent.click(screen.getByRole('button', { name: 'Unregister' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unregister' }))
    await waitFor(() => expect(deleteRepository).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/projects/shop'))
  })
})

describe('what a role is shown', () => {
  // Unregistering a repository is a write on the Project. A viewer, and a
  // developer who is not in it, are offered nothing to click.
  it('offers no unregister to somebody who may not manage repositories', async () => {
    renderWithQuery(view(), undefined, principal({ role: 'viewer', permissions: ['repository:read'] }))
    await screen.findByRole('heading', { name: 'api' })
    expect(screen.queryByRole('button', { name: 'Unregister' })).not.toBeInTheDocument()
  })
})
