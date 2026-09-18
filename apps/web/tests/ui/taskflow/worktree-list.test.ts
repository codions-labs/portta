import { describe, expect, it, vi } from 'vitest'
import { WorktreeList } from '@/modules/taskflow/components/worktrees/worktree-list'
import type { WorktreeInfo, WorktreeListRow } from '@/modules/taskflow/lib/types'
import { fireEvent, openMenu, render, screen, within } from './render.tsx'

function createWorktree(branch: string): WorktreeInfo {
  return {
    branch,
    label: null,
    archived: false,
    agent: 'claude',
    mux: '✓',
    path: `/tmp/${branch}`,
    dir: `/tmp/${branch}`,
    dirty: false,
    unpushed: false,
    status: 'running',
    elapsed: '1m',
    profile: null,
    agentName: null,
    agentLabel: null,
    agentTerminalStale: false,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: {
      identifier: 'ENG-42',
      url: 'https://linear.app/example/issue/ENG-42',
      state: {
        name: 'In Progress',
        color: '#5e6ad2',
        type: 'started',
      },
    },
    creating: false,
    creationPhase: null,
    source: 'ui',
    oneshot: null,
    tabs: [],
    activeTabId: null,
  }
}

function createRow(worktree: WorktreeInfo, depth = 0): WorktreeListRow {
  return { worktree, depth }
}

describe('WorktreeList', () => {
  it('calls onRemove without selecting the row when the remove button is clicked', async () => {
    const onSelect = vi.fn()
    const onRemove = vi.fn()

    const { container } = render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree('feature/list-actions'))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(),
        postingLinear: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onSelect,
        onClose: vi.fn(),
        onArchive: vi.fn(),
        onMerge: vi.fn(),
        onCreateSubworktree: vi.fn(),
        onRemove,
        onEditProfile: vi.fn(),
      },
    })

    openMenu(within(container).getByRole('button', { name: /actions for feature\/list-actions/i }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))

    expect(onRemove).toHaveBeenCalledWith('feature/list-actions')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disables row actions while a worktree is being removed', () => {
    const { container } = render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree('feature/list-removing'))],
        selected: null,
        removing: new Set(['feature/list-removing']),
        initializing: new Set<string>(),
        archiving: new Set<string>(),
        postingLinear: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onArchive: vi.fn(),
        onMerge: vi.fn(),
        onCreateSubworktree: vi.fn(),
        onRemove: vi.fn(),
        onEditProfile: vi.fn(),
      },
    })

    expect(screen.getByText('feature/list-removing').closest('button')).toBeDisabled()
    expect(within(container).getByRole('button', { name: /actions for feature\/list-removing/i })).toBeDisabled()
  })

  it('shows a three-dot menu with row actions', async () => {
    const onArchive = vi.fn()

    render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree('feature/menu-actions'))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(),
        postingLinear: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onArchive,
        onMerge: vi.fn(),
        onCreateSubworktree: vi.fn(),
        onRemove: vi.fn(),
        onEditProfile: vi.fn(),
      },
    })

    openMenu(screen.getByRole('button', { name: /actions for feature\/menu-actions/i }))

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Merge' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(onArchive).toHaveBeenCalledWith('feature/menu-actions')
  })

  it('calls onCreateSubworktree with the row branch from the menu', async () => {
    const onCreateSubworktree = vi.fn()

    render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree('feature/sub-base'))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(),
        postingLinear: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onArchive: vi.fn(),
        onMerge: vi.fn(),
        onCreateSubworktree,
        onRemove: vi.fn(),
        onEditProfile: vi.fn(),
      },
    })

    openMenu(screen.getByRole('button', { name: /actions for feature\/sub-base/i }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Create sub-worktree' }))

    expect(onCreateSubworktree).toHaveBeenCalledWith('feature/sub-base')
  })

  it('renders labels as the primary row name with the branch below', () => {
    render(WorktreeList, {
      props: {
        rows: [createRow({ ...createWorktree('feature/random-fallback'), label: 'Search ranking' })],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(),
        postingLinear: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onArchive: vi.fn(),
        onMerge: vi.fn(),
        onCreateSubworktree: vi.fn(),
        onRemove: vi.fn(),
        onEditProfile: vi.fn(),
      },
    })

    expect(screen.getByText('Search ranking')).toBeInTheDocument()
    expect(screen.getByText('feature/random-fallback')).toBeInTheDocument()
  })

  it('disables the archive action while the row is archiving', async () => {
    render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree('feature/archiving'))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(['feature/archiving']),
        postingLinear: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onArchive: vi.fn(),
        onMerge: vi.fn(),
        onCreateSubworktree: vi.fn(),
        onRemove: vi.fn(),
        onEditProfile: vi.fn(),
      },
    })

    openMenu(screen.getByRole('button', { name: /actions for feature\/archiving/i }))

    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute('aria-disabled', 'true')
  })
})
