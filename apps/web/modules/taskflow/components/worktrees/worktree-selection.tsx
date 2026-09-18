'use client'

// Which worktrees the sidebar shows and which one is open.
//
// The selection itself is the URL (`/worktrees/:name`); this provider holds
// the list filters every part of the dashboard has to respect when it opens a
// worktree — a notification, a Run's session, a new worktree — so the row it
// opens is never hidden behind a search or the archived toggle.

import { useRouter } from 'next/navigation'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useTaskflowProject } from '../../lib/project.tsx'
import { useWorktrees } from '../../lib/queries/worktrees.ts'
import type { WorktreeInfo, WorktreeListRow } from '../../lib/types.ts'
import {
  buildWorktreeListRows,
  countArchivedMatches,
  filterWorktrees,
  matchesWorktreeSearch,
} from '../../lib/worktree-list.ts'
import { useNotifications } from '../shell/notifications.tsx'
import { useSidebarState } from '../shell/sidebar-state.tsx'
import { useSelectedBranch } from './use-selected-branch.ts'

interface WorktreeSelection {
  worktrees: WorktreeInfo[]
  hasLoadedWorktrees: boolean
  selectedBranch: string | null
  selectedWorktree: WorktreeInfo | undefined
  searchQuery: string
  setSearchQuery: (query: string) => void
  showArchived: boolean
  setShowArchived: (show: boolean) => void
  trimmedSearch: string
  archivedCount: number
  hiddenArchivedMatchCount: number
  visibleWorktrees: WorktreeInfo[]
  visibleRows: WorktreeListRow[]
  /** Clear whichever filter hides the worktree, so opening it also shows its row. */
  reveal: (branch: string) => void
  /** Go to a worktree, or to the list when there is none to go to. */
  navigateTo: (branch: string | null, options?: { replace?: boolean }) => void
  /** What a click on a row does: reveal it, open it, mark it read and uncover the page on a phone. */
  select: (branch: string) => void
}

const WorktreeSelectionContext = createContext<WorktreeSelection | null>(null)

export function WorktreeSelectionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { paths } = useTaskflowProject()
  const query = useWorktrees()
  const selectedBranch = useSelectedBranch()
  const { clearNotified } = useNotifications()
  const { closeOnMobile } = useSidebarState()
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const worktrees = useMemo(() => query.data ?? [], [query.data])
  const trimmedSearch = searchQuery.trim()
  const visibleWorktrees = useMemo(
    () => filterWorktrees(worktrees, { query: trimmedSearch, showArchived }),
    [showArchived, trimmedSearch, worktrees],
  )
  const visibleRows = useMemo(() => buildWorktreeListRows(visibleWorktrees), [visibleWorktrees])

  const reveal = useCallback(
    (branch: string): void => {
      const worktree = worktrees.find((candidate) => candidate.branch === branch)
      if (!worktree) return
      if (worktree.archived) setShowArchived(true)
      if (trimmedSearch && !matchesWorktreeSearch(worktree, trimmedSearch)) setSearchQuery('')
    },
    [trimmedSearch, worktrees],
  )

  const navigateTo = useCallback(
    (branch: string | null, options: { replace?: boolean } = {}): void => {
      const href = branch ? paths.worktree(branch) : paths.worktrees()
      if (options.replace) router.replace(href)
      else router.push(href)
    },
    [paths, router],
  )

  const select = useCallback(
    (branch: string): void => {
      reveal(branch)
      navigateTo(branch)
      clearNotified(branch)
      closeOnMobile()
    },
    [clearNotified, closeOnMobile, navigateTo, reveal],
  )

  const value = useMemo<WorktreeSelection>(
    () => ({
      worktrees,
      hasLoadedWorktrees: query.isSuccess,
      selectedBranch,
      selectedWorktree: selectedBranch ? worktrees.find((worktree) => worktree.branch === selectedBranch) : undefined,
      searchQuery,
      setSearchQuery,
      showArchived,
      setShowArchived,
      trimmedSearch,
      archivedCount: worktrees.filter((worktree) => worktree.archived).length,
      hiddenArchivedMatchCount: showArchived ? 0 : countArchivedMatches(worktrees, trimmedSearch),
      visibleWorktrees,
      visibleRows,
      reveal,
      navigateTo,
      select,
    }),
    [
      navigateTo,
      query.isSuccess,
      reveal,
      searchQuery,
      select,
      selectedBranch,
      showArchived,
      trimmedSearch,
      visibleRows,
      visibleWorktrees,
      worktrees,
    ],
  )

  return <WorktreeSelectionContext.Provider value={value}>{children}</WorktreeSelectionContext.Provider>
}

export function useWorktreeSelection(): WorktreeSelection {
  const value = useContext(WorktreeSelectionContext)
  if (!value) throw new Error('WorktreeSelectionProvider is not mounted')
  return value
}
