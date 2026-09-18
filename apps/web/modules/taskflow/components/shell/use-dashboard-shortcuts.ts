'use client'

import { useEffect } from 'react'
import { useWorktreeActions } from '../worktrees/worktree-actions.tsx'
import { useWorktreeSelection } from '../worktrees/worktree-selection.tsx'

/**
 * The dashboard's keyboard: ⌘↑/⌘↓ move between worktrees, ⌘⇧K opens a new
 * run (⌘K is the panel's command palette), ⌘M merges, ⌘D removes and ⌘↵ opens a closed session. They work while
 * the terminal has focus — the terminal hands these keys back — and stand down
 * while a dialog owns the keyboard.
 */
export function useDashboardShortcuts(): void {
  const actions = useWorktreeActions()
  const { visibleWorktrees, selectedBranch, selectedWorktree, navigateTo } = useWorktreeSelection()

  useEffect(() => {
    const selectable = visibleWorktrees.filter((worktree) => !actions.removing.has(worktree.branch))

    function selectNeighbor(direction: -1 | 1): void {
      if (selectable.length === 0) return
      if (!selectedBranch) {
        const edge = direction === 1 ? selectable[0] : selectable.at(-1)
        if (edge) navigateTo(edge.branch)
        return
      }
      const index = selectable.findIndex((worktree) => worktree.branch === selectedBranch)
      const next = selectable[index + direction]
      if (next) navigateTo(next.branch)
    }

    const onKeydown = (event: KeyboardEvent): void => {
      if (actions.dialogOpen) return
      if (!event.metaKey && !event.ctrlKey) return
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        selectNeighbor(event.key === 'ArrowUp' ? -1 : 1)
      } else if (event.key.toLowerCase() === 'k' && event.shiftKey) {
        event.preventDefault()
        actions.openCreate()
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        if (selectedBranch) actions.requestMerge(selectedBranch)
      } else if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        if (selectedBranch) actions.requestRemove(selectedBranch)
      } else if (
        event.key === 'Enter' &&
        selectedWorktree &&
        selectedWorktree.mux !== '✓' &&
        !selectedWorktree.creating &&
        !actions.opening.has(selectedWorktree.branch)
      ) {
        event.preventDefault()
        actions.open(selectedWorktree.branch)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [actions, navigateTo, selectedBranch, selectedWorktree, visibleWorktrees])
}
