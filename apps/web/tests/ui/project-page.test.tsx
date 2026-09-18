import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Project } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEvent, makeRepository, makeSession } from './fixtures.ts'
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
const deleteProject = vi.fn()
const patchProject = vi.fn()
const githubRepositories = vi.fn()
const createRepository = vi.fn()
const deleteRepository = vi.fn()
const discoveredRepositories = vi.fn()
const environments = vi.fn()
const sessions = vi.fn()
const projectActivity = vi.fn()
const metricsCurrent = vi.fn()
const setProjectEnvironments = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    project: (slug: string) => project(slug),
    deleteProject: (slug: string) => deleteProject(slug),
    patchProject: (slug: string, body: unknown) => patchProject(slug, body),
    githubRepositories: () => githubRepositories(),
    createRepository: (...args: unknown[]) => createRepository(...args),
    deleteRepository: (id: string) => deleteRepository(id),
    discoveredRepositories: () => discoveredRepositories(),
    environments: () => environments(),
    environmentGit: () => Promise.resolve(null),
    sessions: (slug: string, filters: unknown) => sessions(slug, filters),
    projectActivity: (slug: string, filters: unknown) => projectActivity(slug, filters),
    metricsCurrent: () => metricsCurrent(),
    setProjectEnvironments: (slug: string, list: string[]) => setProjectEnvironments(slug, list),
  },
}))

const { RepositoriesTab } = await import('@/components/projects/repositories-tab')
const { SettingsTab } = await import('@/components/projects/settings-tab')

const detail: Project = {
  id: 'ws-1',
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  taskProvider: null,
  linearTeam: null,
  work: { provider: null, coordinate: null, reason: null },
  relativePath: null,
  resolvedPath: null,
  location: 'external',
  repositories: [
    makeRepository({
      id: 'r1',
      name: 'web',
      role: 'web',
      environments: [],
      github: { slug: 'acme/api', htmlUrl: 'https://github.com/acme/api', role: null, position: 0 },
    }),
  ],
  environments: [
    {
      environment: 'alpha',
      source: 'label',
      running: true,
      serviceCount: 2,
      runningCount: 2,
      unhealthyCount: 0,
      urls: [],
    },
  ],
}

beforeEach(() => {
  project.mockReset().mockResolvedValue(detail)
  deleteProject.mockReset().mockResolvedValue({ ok: true, removed: 'meu-produto', note: '' })
  patchProject.mockReset().mockResolvedValue(detail)
  githubRepositories.mockReset().mockResolvedValue([
    { githubId: 1, fullName: 'acme/alpha', private: true },
    { githubId: 2, fullName: 'acme/api', private: false },
  ])
  createRepository.mockReset().mockResolvedValue(detail.repositories[0])
  deleteRepository.mockReset().mockResolvedValue({ ok: true, removed: 'r1', note: '' })
  discoveredRepositories.mockReset().mockResolvedValue([
    {
      key: 'abcdef012345',
      path: '/srv/projects/shop/web',
      name: 'web',
      remote: null,
      location: 'managed',
      relativePath: 'shop/web',
      environments: ['alpha'],
    },
  ])
  environments.mockReset().mockResolvedValue([])
  sessions.mockReset().mockResolvedValue([makeSession({ project: 'meu-produto' })])
  projectActivity.mockReset().mockResolvedValue({ events: [makeEvent({ project: 'meu-produto' })], nextBefore: null })
  metricsCurrent.mockReset().mockResolvedValue({
    version: 1,
    instance: { id: 'i', name: 'lab', hostname: 'lab' },
    collectedAt: null,
    ageSeconds: null,
    stale: true,
    collectorActive: false,
    host: null,
    runtime: null,
    projects: [],
  })
  setProjectEnvironments.mockReset().mockResolvedValue(detail)
  navigation.push.mockReset()
  navigation.pathname = '/projects/meu-produto'
  navigation.search = ''
})

describe('the project cockpit', () => {
  it('adds a repository the host scanned from the repositories tab', async () => {
    renderWithQuery(<RepositoriesTab project={detail} readOnly={false} />)
    await screen.findByRole('group', { name: 'web repository' })
    await userEvent.click(screen.getByRole('button', { name: /Add repository/ }))
    expect(await screen.findByText('shop/web')).toHaveAttribute('title', '/srv/projects/shop/web')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(createRepository).toHaveBeenCalledWith('meu-produto', { scanKey: 'abcdef012345' }))
  })

  it('deletes the project only after the slug is typed back, and says what stays', async () => {
    renderWithQuery(<SettingsTab project={detail} readOnly={false} />)
    expect(await screen.findByText(/every container, volume, network/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    const confirm = screen.getByRole('button', { name: 'Delete project' })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type meu-produto to confirm'), 'meu-produto', { delay: null })
    await userEvent.click(confirm)
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('meu-produto'))
  })
})

describe('what a role is shown', () => {
  const viewer = principal({ role: 'viewer', permissions: ['project:read', 'repository:read'] })

  it('offers a viewer no repository to add, and no way to remove one', async () => {
    renderWithQuery(<RepositoriesTab project={detail} readOnly={false} />, undefined, viewer)
    await screen.findByRole('group', { name: 'web repository' })
    expect(screen.queryByRole('button', { name: /Add repository/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unregister' })).not.toBeInTheDocument()
  })

  it('offers a viewer neither form on the settings tab, and says what the tab is', async () => {
    renderWithQuery(<SettingsTab project={detail} readOnly={false} />, undefined, viewer)
    expect(await screen.findByText('Project')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
