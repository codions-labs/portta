import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const createProject = vi.fn()
const setProjectEnvironments = vi.fn()

class ApiError extends Error {}

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    createProject: (...args: unknown[]) => createProject(...args),
    setProjectEnvironments: (...args: unknown[]) => setProjectEnvironments(...args),
  },
}))

const { UnownedGroup } = await import('@/components/projects/project-group')

const folder = '/root/projects/tuttoria/tuttoria'

beforeEach(() => {
  createProject.mockReset().mockResolvedValue({ slug: 'tuttoria' })
  setProjectEnvironments.mockReset().mockResolvedValue({})
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
