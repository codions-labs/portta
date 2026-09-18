'use client'

import { usePathname } from 'next/navigation'
import { taskflowLocation } from '../../lib/navigation.ts'
import { useTaskflowProject } from '../../lib/project.tsx'
import { loadSavedSelectedWorktree } from '../../lib/utils.ts'

/**
 * The worktree the dashboard is about: the one in the URL on a worktree page,
 * and the last one opened everywhere else, so a shortcut still has a target.
 */
export function useSelectedBranch(): string | null {
  const { slug, prefix } = useTaskflowProject()
  const location = taskflowLocation(usePathname(), slug)
  if (location.section === 'worktrees') return location.id
  return loadSavedSelectedWorktree(prefix)
}
