import { screen, waitFor, within } from '@testing-library/react'
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
const setProjectTags = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    projects: () => projects(),
    environments: () => environments(),
    developmentOverview: () => developmentOverview(),
    environmentAction: (...args: unknown[]) => environmentAction(...args),
    patchProject: (...args: unknown[]) => patchProject(...args),
    deleteProject: (...args: unknown[]) => deleteProject(...args),
    setProjectTags: (...args: unknown[]) => setProjectTags(...args),
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
    pinned: false,
    relativePath: null,
    location: 'external',
    tags: [],
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
  environments.mockReset().mockResolvedValue([])
  developmentOverview.mockReset().mockResolvedValue(makeOverview({ projects: [makePulse()] }))
  environmentAction.mockReset().mockResolvedValue({ ok: true })
  patchProject.mockReset().mockResolvedValue({})
  deleteProject.mockReset().mockResolvedValue({ ok: true, removed: 'produto', note: 'the grouping only' })
  setProjectTags.mockReset().mockResolvedValue({})
  localStorage.clear()
  navigation.push.mockReset()
})

describe('tags on the Projects page', () => {
  const acme = { key: 'cliente', value: 'Acme' }
  const globex = { key: 'cliente', value: 'Globex' }

  beforeEach(() => {
    projects.mockResolvedValue([summary({ tags: [acme] }), { ...idle, tags: [globex] }])
  })

  it('filters to one tag', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: /^cliente: Globex/ }))
    expect(screen.queryByRole('link', { name: 'Meu Produto' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Loja' })).toBeInTheDocument()
  })

  it('groups by a key in use, one band per value', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('radio', { name: 'Cliente' }))
    const bands = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(bands).toEqual(expect.arrayContaining(['Acme', 'Globex']))
  })

  it('adds a tag written as key: value, keeping the ones already there', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Add a tag' })[0] as HTMLElement)
    await userEvent.type(screen.getByLabelText('New tag'), 'time: Loja{Enter}')
    expect(setProjectTags).toHaveBeenCalledWith('produto', [acme, { key: 'time', value: 'Loja' }])
  })

  it('removes one, and offers neither to somebody who may not edit', async () => {
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: 'Remove the tag cliente: Acme' }))
    expect(setProjectTags).toHaveBeenCalledWith('produto', [])
  })

  it('does not offer to edit to somebody who only reads', async () => {
    renderWithQuery(view(), undefined, principal({ permissions: ['project:read'] }))
    await screen.findByRole('link', { name: 'Meu Produto' })
    expect(screen.queryByRole('button', { name: 'Add a tag' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove the tag/ })).toBeNull()
  })
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

  it('tags several projects at once, keeping what each already carries', async () => {
    projects.mockResolvedValue([
      summary({ tags: [{ key: '', value: 'loja' }] }),
      { ...idle, tags: [{ key: 'cliente', value: 'Acme' }] },
    ])
    developmentOverview.mockResolvedValue(makeOverview({ projects: [] }))
    renderWithQuery(view())
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select every row' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tag' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('New tag'), 'time: web', { delay: null })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(setProjectTags).toHaveBeenCalledTimes(2))
    expect(setProjectTags).toHaveBeenCalledWith('produto', [
      { key: '', value: 'loja' },
      { key: 'time', value: 'web' },
    ])
    expect(setProjectTags).toHaveBeenCalledWith(idle.slug, [
      { key: 'cliente', value: 'Acme' },
      { key: 'time', value: 'web' },
    ])
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
    expect(screen.queryByRole('button', { name: 'Add project' })).not.toBeInTheDocument()
  })
})
