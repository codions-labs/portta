import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const projectFiles = vi.fn()
const projectFile = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class extends Error {},
  api: {
    projectFiles: (...args: unknown[]) => projectFiles(...args),
    projectFile: (...args: unknown[]) => projectFile(...args),
  },
}))

const { ProjectFilesTab, treeRows } = await import('@/components/projects/project-files')

const file = (path: string, over: Record<string, unknown> = {}) => ({
  path,
  kind: 'file',
  size: 10,
  status: null,
  ignored: false,
  readable: 'text',
  diff: false,
  ...over,
})

beforeEach(() => {
  projectFiles.mockReset().mockResolvedValue({
    environments: ['alpha'],
    environment: 'alpha',
    branch: 'develop',
    head: { hash: 'a41f2c9', subject: 'first', at: 1_700_000_000 },
    changed: 1,
    untracked: 0,
    ahead: 2,
    collectedAt: 1_700_000_100,
    truncated: false,
    files: [
      file('src/app.ts', { status: 'M', diff: true }),
      file('src/cart/index.ts'),
      file('.env', { readable: 'hidden' }),
      file('node_modules', { kind: 'dir', ignored: true, readable: 'omitted' }),
    ],
  })
  projectFile.mockReset().mockResolvedValue({
    environment: 'alpha',
    path: 'src/app.ts',
    content: 'export const one = 2\n',
    diff: '-export const one = 1\n+export const one = 2\n',
  })
})

describe('the tree', () => {
  const files = [
    file('src/app.ts', { status: 'M' }),
    file('src/cart/index.ts'),
    file('README.md'),
    file('node_modules', { kind: 'dir', ignored: true }),
  ] as never

  it('puts a folder above what is in it, and folders before files', () => {
    expect(treeRows(files, { onlyChanged: false, query: '' }).map((row) => row.path)).toEqual([
      'node_modules',
      'src',
      'src/cart',
      'src/cart/index.ts',
      'src/app.ts',
      'README.md',
    ])
  })

  it('keeps the folders of what it shows, and only that', () => {
    expect(treeRows(files, { onlyChanged: true, query: '' }).map((row) => row.path)).toEqual(['src', 'src/app.ts'])
    expect(treeRows(files, { onlyChanged: false, query: 'CART' }).map((row) => row.path)).toEqual([
      'src',
      'src/cart',
      'src/cart/index.ts',
    ])
  })
})

describe('reading a file', () => {
  it('shows the changes of a changed file and the whole file on request', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ProjectFilesTab slug="produto" />)
    await user.click(await screen.findByRole('button', { name: /app\.ts/ }))
    expect(await screen.findByText('+export const one = 2')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'File' }))
    expect(await screen.findByText('export const one = 2')).toBeInTheDocument()
    expect(projectFile).toHaveBeenCalledWith('produto', 'alpha', 'src/app.ts')
  })

  it('says a file with secrets exists and asks the server for none of it', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ProjectFilesTab slug="produto" />)
    await user.click(await screen.findByRole('button', { name: /\.env/ }))
    expect(await screen.findByText('Content hidden.')).toBeInTheDocument()
    await waitFor(() => expect(projectFile).not.toHaveBeenCalled())
  })

  it('explains an empty project instead of showing an empty tree', async () => {
    projectFiles.mockResolvedValue({ environments: [], environment: null, files: [] })
    renderWithQuery(<ProjectFilesTab slug="produto" />)
    expect(await screen.findByText('No copy of these files yet')).toBeInTheDocument()
  })
})
