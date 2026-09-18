import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeOverview, makePulse } from './fixtures.ts'
import { principal, renderWithQuery } from './render.tsx'
import { navigation } from './setup.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const projects = vi.fn()
const environments = vi.fn()
const developmentOverview = vi.fn()
const environmentAction = vi.fn()
const patchProject = vi.fn()
const deleteProject = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    projects: () => projects(),
    environments: () => environments(),
    developmentOverview: () => developmentOverview(),
    environmentAction: (...args: unknown[]) => environmentAction(...args),
    patchProject: (...args: unknown[]) => patchProject(...args),
    deleteProject: (...args: unknown[]) => deleteProject(...args),
  },
}))

const { ProjectsView } = await import('../../app/(panel)/projects/projects-view.tsx')

/** The page's server half already read these; the view takes them as given. */
function view(overrides: { projects?: unknown[]; overview?: unknown } = {}) {
  return (
    <ProjectsView
      initialProjects={(overrides.projects ?? []) as never}
      initialOverview={(overrides.overview ?? makeOverview({ projects: [] })) as never}
    />
  )
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    slug: 'produto',
    name: 'Meu Produto',
    description: 'The thing we sell',
    archived: false,
    relativePath: null,
    location: 'external',
    repositoryCount: 2,
    environmentCount: 1,
    runningEnvironmentCount: 1,
    environments: [{ name: 'produto', running: true, serviceCount: 5, runningCount: 5, unhealthyCount: 0 }],
    ...overrides,
  }
}

const idle = summary({
  id: 'ws-2',
  slug: 'loja',
  name: 'Loja',
  description: null,
  runningEnvironmentCount: 0,
  environments: [{ name: 'loja', running: false, serviceCount: 2, runningCount: 0, unhealthyCount: 0 }],
})

beforeEach(() => {
  projects.mockReset().mockResolvedValue([summary()])
  environments.mockReset().mockResolvedValue([{ name: 'alpha' }, { name: 'beta' }])
  developmentOverview.mockReset().mockResolvedValue(makeOverview({ projects: [makePulse()] }))
  environmentAction.mockReset().mockResolvedValue({ ok: true })
  patchProject.mockReset().mockResolvedValue({})
  deleteProject.mockReset().mockResolvedValue({ ok: true, removed: 'produto', note: 'the grouping only' })
  localStorage.clear()
  navigation.push.mockReset()
})

describe('the Projects page', () => {
  it('states what stopping a project would interrupt before it does it', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop environments Meu Produto' }))
    expect(await screen.findByText('Stop Meu Produto?')).toBeInTheDocument()
    expect(screen.getByText('This interrupts 5 containers across 1 environments.')).toBeInTheDocument()
    expect(environmentAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Stop environments' }))
    expect(environmentAction).toHaveBeenCalledWith('produto', 'stop')
  })

  it('acts on several projects at once, after saying what it will interrupt', async () => {
    projects.mockResolvedValue([summary(), idle])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select every row' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    // Only the project with something running is named, and only its containers counted.
    expect(await screen.findByText('This interrupts 5 containers.')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }))
    expect(environmentAction).toHaveBeenCalledWith('produto', 'stop')
    expect(environmentAction).not.toHaveBeenCalledWith('loja', 'stop')
  })

  it('will not delete a project until its slug is typed', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Meu Produto' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete project' }))

    const confirm = await screen.findByRole('button', { name: 'Delete project' })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type produto to confirm'), 'produto', { delay: null })
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(deleteProject).toHaveBeenCalledWith('produto')
  })
})

describe('what a role is shown', () => {
  // Hidden rather than disabled: a control that is never available to this role
  // is noise, not a hint. The API refuses it either way.
  it('offers no way to create a Project to somebody who may not', async () => {
    renderWithQuery(view(), undefined, principal({ role: 'developer', permissions: ['project:read'] }))
    await screen.findByRole('link', { name: 'Meu Produto' })
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
  })
})
