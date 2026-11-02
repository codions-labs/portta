import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEnvironment } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const environments = vi.fn()

class ApiError extends Error {}

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    environments: () => environments(),
    projects: () => Promise.resolve([]),
    project: () => Promise.reject(new Error('none')),
    createProject: vi.fn(),
  },
}))

const { AddProjectView } = await import('../../app/(panel)/projects/new/add-project-view.tsx')

beforeEach(() => {
  environments.mockReset().mockResolvedValue([makeEnvironment({ name: 'external-billing' })])
})

describe('Add a project', () => {
  it('writes the commands for the folder that was typed, quoting what a shell would split', async () => {
    renderWithQuery(<AddProjectView />)
    await userEvent.type(screen.getByLabelText('Folder path'), "~/my shop's", { delay: null })
    expect(screen.getByText("portta adopt '~/my shop'\\''s'")).toBeInTheDocument()
    expect(screen.getByText("portta envs analyze '~/my shop'\\''s'")).toBeInTheDocument()
  })

  it('names what runs with no project', async () => {
    renderWithQuery(<AddProjectView />)
    expect(await screen.findByText('external-billing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Adopt 1' })).toHaveAttribute('href', '/projects')
  })

  it('opens the empty project dialog', async () => {
    renderWithQuery(<AddProjectView />)
    await userEvent.click(screen.getByRole('button', { name: 'Create an empty project' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
