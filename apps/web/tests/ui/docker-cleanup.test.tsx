import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { principal, renderWithQuery } from './render.tsx'

const MB = 1000 * 1000
const images = vi.fn()
const volumes = vi.fn()
const usage = vi.fn()
const removeDockerResources = vi.fn()
const pruneDocker = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    dockerImages: () => images(),
    dockerVolumes: () => volumes(),
    dockerUsage: () => usage(),
    removeDockerResources: (...args: unknown[]) => removeDockerResources(...args),
    pruneDocker: (...args: unknown[]) => pruneDocker(...args),
  },
}))

const { ImagesView } = await import('../../app/(panel)/host/images/images-view.tsx')
const { VolumesView } = await import('../../app/(panel)/host/volumes/volumes-view.tsx')
const { MaintenanceView } = await import('../../app/(panel)/host/maintenance/maintenance-view.tsx')

const image = (id: string, tag: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  tags: tag ? [tag] : [],
  dangling: tag === null,
  sizeBytes: 100 * MB,
  uniqueBytes: 80 * MB,
  createdAt: 1_700_000_000,
  containerCount: 0,
  protection: null,
  ...extra,
})
const volume = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  driver: 'local',
  sizeBytes: 5 * MB,
  createdAt: 1_700_000_000,
  containerCount: 0,
  anonymous: false,
  project: null,
  protection: null,
  ...extra,
})

beforeEach(() => {
  images.mockReset().mockResolvedValue({
    images: [
      image('a1', 'old-app:1'),
      image('a2', null),
      image('a3', 'traefik:v3', { protection: 'portta', containerCount: 1 }),
      image('a4', 'shop:latest', { protection: 'in-use', containerCount: 1 }),
    ],
    totalBytes: 400 * MB,
    reclaimableBytes: 160 * MB,
  })
  volumes.mockReset().mockResolvedValue({
    volumes: [
      volume('old_db', { sizeBytes: 700 * MB }),
      volume('portta_acme', { protection: 'portta', containerCount: 1 }),
      volume('shop_data', { protection: 'in-use', containerCount: 1 }),
    ],
    totalBytes: 705 * MB,
    reclaimableBytes: 700 * MB,
  })
  usage.mockReset().mockResolvedValue({
    containers: { total: 4, stopped: 1 },
    networks: { total: 6, unused: 2 },
    images: { total: 4, totalBytes: 400 * MB, dangling: 1, danglingBytes: 80 * MB, unused: 2, unusedBytes: 160 * MB },
    volumes: { total: 3, totalBytes: 705 * MB, anonymous: 0, anonymousBytes: 0, unused: 1, unusedBytes: 700 * MB },
    buildCacheBytes: 50 * MB,
  })
  removeDockerResources.mockReset().mockResolvedValue({ removed: 2, failed: 0, skipped: 0, freedBytes: 0, results: [] })
  pruneDocker.mockReset().mockResolvedValue({ dryRun: true, removed: 0, failed: 0, freedBytes: 0, items: [] })
})

describe('Host > Images', () => {
  it('shows sizes, and never lets Portta’s or an in-use image be ticked', async () => {
    renderWithQuery(<ImagesView />)
    const list = await screen.findByRole('list', { name: 'Images' })
    expect(within(list).getAllByText('100 MB')).toHaveLength(4)
    expect(screen.getByRole('checkbox', { name: /traefik:v3 is protected/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /shop:latest is protected/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everything that can be removed' }))
    expect(screen.getByRole('toolbar')).toHaveTextContent('2 images selected')
  })

  it('removes exactly what was ticked, by id', async () => {
    renderWithQuery(<ImagesView />)
    await screen.findByRole('list', { name: 'Images' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everything that can be removed' }))
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove 2 images' }))
    await waitFor(() => expect(removeDockerResources).toHaveBeenCalledWith('images', ['a1', 'a2']))
  })

  it('offers no way to remove to somebody who may only read', async () => {
    renderWithQuery(<ImagesView />, undefined, principal({ role: 'viewer', permissions: ['docker:read'] }))
    await screen.findByRole('list', { name: 'Images' })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

describe('Host > Volumes', () => {
  it('asks for the count to be typed back before a volume is deleted', async () => {
    renderWithQuery(<VolumesView />)
    await screen.findByRole('list', { name: 'Volumes' })
    expect(screen.getByRole('checkbox', { name: /portta_acme is protected/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everything that can be removed' }))
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Delete 1 volume' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox'), 'remove 1', { delay: null })
    await userEvent.click(confirm)
    await waitFor(() => expect(removeDockerResources).toHaveBeenCalledWith('volumes', ['old_db']))
  })
})

describe('Host > Maintenance', () => {
  it('previews first, and sweeps only after the word is typed', async () => {
    pruneDocker.mockImplementation(async (body: { dryRun: boolean }) => ({
      dryRun: body.dryRun,
      removed: 1,
      failed: 0,
      freedBytes: 80 * MB,
      items: [{ kind: 'image', id: 'a2', name: 'a2', ok: true, skipped: false, reason: null, sizeBytes: 80 * MB }],
    }))
    renderWithQuery(<MaintenanceView />)
    const clean = await screen.findByRole('button', { name: 'Clean now' })
    // Nothing can be swept before somebody has seen what would go.
    expect(clean).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'See what will be removed' }))
    await screen.findByText('1 item will be removed')
    expect(pruneDocker).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, volumes: 'none' }))

    await userEvent.click(clean)
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Clean now' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox'), 'clean', { delay: null })
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(pruneDocker).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, candidates: ['image:a2'] })),
    )
  })

  it('warns that unused named volumes are data before it offers to delete them', async () => {
    renderWithQuery(<MaintenanceView />)
    await screen.findByRole('button', { name: 'Clean now' })
    expect(screen.queryByText(/usually the database of a project/)).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Volumes'), 'unused')
    expect(screen.getByText(/usually the database of a project/)).toBeInTheDocument()
  })
})
