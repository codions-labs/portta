import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const folderPlan = vi.fn()
const createProject = vi.fn()
const push = vi.fn()

class ApiError extends Error {}

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    folderPlan: (...args: unknown[]) => folderPlan(...args),
    createProject: (...args: unknown[]) => createProject(...args),
  },
}))

const { ReviewView } = await import('../../app/(panel)/projects/new/review/review-view.tsx')

beforeEach(() => {
  push.mockReset()
  createProject.mockReset().mockResolvedValue({ slug: 'loja-nova' })
  folderPlan.mockReset().mockResolvedValue({
    home: '/home/ada/projects',
    path: 'loja-nova',
    composeFile: 'compose.yaml',
    project: { name: 'loja-nova', source: 'directory name (implicit)' },
    domain: 'portta.example',
    adopted: false,
    services: [
      { name: 'web', image: 'nginx', kind: 'http', port: '3000', publishedPorts: [], containerName: null },
      {
        name: 'postgres',
        image: 'postgres',
        kind: 'datastore',
        port: null,
        publishedPorts: [{ host: '5432', container: '5432' }],
        containerName: 'loja-db',
      },
    ],
    findings: {
      publishedHostPorts: ['postgres'],
      fixedContainerNames: ['postgres'],
      publishedDatastores: ['postgres'],
      implicitNamespace: true,
      containerNameCollisions: [{ service: 'postgres', containerName: 'loja-db', usedBy: 'Compose project outro' }],
      namespaceInUse: null,
    },
    collectedAt: 1,
    command: 'portta adopt /home/ada/projects/loja-nova --project loja-nova',
  })
})

describe('Reviewing a folder before adopting it', () => {
  it('shows the services, what changes and the collisions the host already has', async () => {
    renderWithQuery(<ReviewView path="loja-nova" />)
    expect(await screen.findByText('loja-nova--web.portta.example')).toBeInTheDocument()
    expect(screen.getByText(/Port 5432:5432 of postgres stops being published/)).toBeInTheDocument()
    expect(screen.getByText(/already uses it/)).toBeInTheDocument()
  })

  it('puts who may open each site into the command that adopts the folder', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ReviewView path="loja-nova" />)
    await screen.findByText('loja-nova--web.portta.example')
    expect(screen.getByText('portta adopt /home/ada/projects/loja-nova --project loja-nova')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Password' }))
    expect(
      screen.getByText('portta adopt /home/ada/projects/loja-nova --project loja-nova --protect web'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Everybody' }))
    expect(
      screen.getByText('portta adopt /home/ada/projects/loja-nova --project loja-nova --public web'),
    ).toBeInTheDocument()
  })

  it('registers the project with this folder, and opens it', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ReviewView path="loja-nova" />)
    await screen.findByText('loja-nova--web.portta.example')
    await user.click(screen.getByRole('button', { name: 'Register project' }))
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        slug: 'loja-nova',
        name: 'Loja Nova',
        description: null,
        relativePath: 'loja-nova',
      }),
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/loja-nova'))
  })
})
