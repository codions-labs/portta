import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeLabelDialog } from '@/modules/taskflow/components/worktrees/worktree-label-dialog'
import { cleanup, fireEvent, render, screen } from './render.tsx'

const originalDialogShowModal = HTMLDialogElement.prototype.showModal
const originalDialogClose = HTMLDialogElement.prototype.close

function renderDialog(
  overrides: {
    initialLabel?: string | null
    onConfirm?: (label: string) => void
    onClear?: () => void
    onCancel?: () => void
  } = {},
): void {
  render(WorktreeLabelDialog, {
    props: {
      branch: 'feature/search',
      initialLabel: null,
      loading: false,
      error: '',
      onConfirm: overrides.onConfirm ?? vi.fn(),
      onClear: overrides.onClear ?? vi.fn(),
      onCancel: overrides.onCancel ?? vi.fn(),
      ...overrides,
    },
  })
}

describe('WorktreeLabelDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement): void {
      this.open = true
    })
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement): void {
      this.open = false
    })
  })

  afterEach(() => {
    cleanup()
    HTMLDialogElement.prototype.showModal = originalDialogShowModal
    HTMLDialogElement.prototype.close = originalDialogClose
  })

  it('disables clear and save when there is no initial label', () => {
    renderDialog()

    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('clears an existing label', async () => {
    const onClear = vi.fn()
    renderDialog({ initialLabel: 'Search ranking', onClear })

    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('submits trimmed changed labels', async () => {
    const onConfirm = vi.fn()
    renderDialog({ initialLabel: 'Search ranking', onConfirm })

    await fireEvent.input(screen.getByLabelText('Label'), {
      target: { value: '  Search filters  ' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onConfirm).toHaveBeenCalledWith('Search filters')
  })

  it('does not submit unchanged labels', async () => {
    const onConfirm = vi.fn()
    renderDialog({ initialLabel: 'Search ranking', onConfirm })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels without saving', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    renderDialog({ initialLabel: 'Search ranking', onCancel, onConfirm })

    await fireEvent.input(screen.getByLabelText('Label'), {
      target: { value: 'Search filters' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
