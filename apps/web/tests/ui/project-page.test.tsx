import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Project } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const environments = vi.fn()
const metricsCurrent = vi.fn()
const setProjectEnvironments = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    project: (slug: string) => project(slug),
    deleteProject: (slug: string) => deleteProject(slug),
    patchProject: (slug: string, body: unknown) => patchProject(slug, body),
    environments: () => environments(),
    metricsCurrent: () => metricsCurrent(),
    setProjectEnvironments: (slug: string, list: string[]) => setProjectEnvironments(slug, list),
  },
}))

const { SettingsTab } = await import('@/components/projects/settings-tab')

const detail: Project = {
  id: 'ws-1',
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  relativePath: null,
  resolvedPath: null,
  location: 'external',
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
  environments.mockReset().mockResolvedValue([])
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
  const viewer = principal({ role: 'viewer', permissions: ['project:read'] })

  it('offers a viewer neither form on the settings tab, and says what the tab is', async () => {
    renderWithQuery(<SettingsTab project={detail} readOnly={false} />, undefined, viewer)
    expect(await screen.findByText('Project')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
