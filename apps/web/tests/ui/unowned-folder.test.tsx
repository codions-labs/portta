import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const createProject = vi.fn()
const setProjectEnvironments = vi.fn()
const project = vi.fn()
const forgetEnvironment = vi.fn()

class ApiError extends Error {
  status: number
  constructor(status: number, message = '') {
    super(message)
    this.status = status
  }
}

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    createProject: (...args: unknown[]) => createProject(...args),
    setProjectEnvironments: (...args: unknown[]) => setProjectEnvironments(...args),
    project: (...args: unknown[]) => project(...args),
    forgetEnvironment: (...args: unknown[]) => forgetEnvironment(...args),
  },
}))

const { UnownedGroup } = await import('@/components/projects/project-group')

const folder = '/root/projects/tuttoria/tuttoria'

beforeEach(() => {
  createProject.mockReset().mockResolvedValue({ slug: 'tuttoria' })
  setProjectEnvironments.mockReset().mockResolvedValue({})
  project.mockReset()
  forgetEnvironment.mockReset().mockResolvedValue({ ok: true })
})

describe('environments that run from one folder', () => {
  it('says they are one folder, and gathers them into a project that adopts what runs there later', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <UnownedGroup
        environments={[
          makeEnvironment({ name: 'tuttoria-main', workingDir: folder }),
          makeEnvironment({ name: 'tuttoria-e2e', workingDir: folder }),
          makeEnvironment({
            name: 'tuttoria-validation',
            workingDir: null,
            services: [
              makeContainer({
                mounts: [
                  {
                    type: 'bind',
                    name: null,
                    source: `${folder}/docker/mysql/init.sql`,
                    destination: '/init.sql',
                    rw: false,
                  },
                ],
              }),
            ],
          }),
          makeEnvironment({ name: 'billing', workingDir: '/srv/billing' }),
        ]}
        projects={[]}
        home="/root/projects"
      />,
    )
    expect(screen.getByText('3 environments run from the same folder')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Group into the Tuttoria project' }))
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        slug: 'tuttoria',
        name: 'Tuttoria',
        description: null,
        relativePath: 'tuttoria/tuttoria',
      }),
    )
    expect(setProjectEnvironments).toHaveBeenCalledWith('tuttoria', [
      'tuttoria-main',
      'tuttoria-e2e',
      'tuttoria-validation',
    ])
  })

  it('puts the environments in the project a first attempt already created', async () => {
    const user = userEvent.setup()
    createProject.mockRejectedValue(new ApiError(409, 'project exists'))
    project.mockResolvedValue({
      slug: 'tuttoria',
      relativePath: 'tuttoria/tuttoria',
      archived: false,
      environments: [{ environment: 'old', source: 'manual' }],
    })
    renderWithQuery(
      <UnownedGroup
        environments={[
          makeEnvironment({ name: 'tuttoria-main', workingDir: folder }),
          makeEnvironment({ name: 'tuttoria-e2e', workingDir: folder, presence: 'remembered' }),
        ]}
        projects={[]}
        home="/root/projects"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Group into the Tuttoria project' }))
    await waitFor(() =>
      expect(setProjectEnvironments).toHaveBeenCalledWith('tuttoria', ['old', 'tuttoria-main', 'tuttoria-e2e']),
    )
  })

  it('does not put the environments in a project that only shares the slug', async () => {
    const user = userEvent.setup()
    createProject.mockRejectedValue(new ApiError(409, 'project exists'))
    project.mockResolvedValue({ slug: 'tuttoria', relativePath: 'other/place', archived: false, environments: [] })
    renderWithQuery(
      <UnownedGroup
        environments={[
          makeEnvironment({ name: 'tuttoria-main', workingDir: folder }),
          makeEnvironment({ name: 'tuttoria-e2e', workingDir: folder }),
        ]}
        projects={[]}
        home="/root/projects"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Group into the Tuttoria project' }))
    await waitFor(() => expect(project).toHaveBeenCalled())
    expect(setProjectEnvironments).not.toHaveBeenCalled()
  })

  it('forgets only the remembered ones, after asking', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <UnownedGroup
        environments={[
          makeEnvironment({ name: 'live', workingDir: '/srv/a' }),
          makeEnvironment({ name: 'old-1', workingDir: '/srv/b', presence: 'remembered' }),
          makeEnvironment({ name: 'old-2', workingDir: '/srv/c', presence: 'remembered' }),
        ]}
        projects={[]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Forget remembered (2)' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Forget remembered (2)' }))
    await waitFor(() => expect(forgetEnvironment).toHaveBeenCalledTimes(2))
    expect(forgetEnvironment).toHaveBeenCalledWith('old-1')
    expect(forgetEnvironment).toHaveBeenCalledWith('old-2')
    expect(forgetEnvironment).not.toHaveBeenCalledWith('live')
  })

  it('offers no group for environments that do not share a folder', () => {
    renderWithQuery(
      <UnownedGroup
        environments={[
          makeEnvironment({ name: 'a', workingDir: '/srv/a' }),
          makeEnvironment({ name: 'b', workingDir: '/srv/b' }),
        ]}
        projects={[]}
      />,
    )
    expect(screen.queryByText(/run from the same folder/)).toBeNull()
  })
})
