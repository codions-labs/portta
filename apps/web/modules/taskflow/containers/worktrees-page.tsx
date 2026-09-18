'use client'

import { WorktreeView } from '../components/worktrees/worktree-view.tsx'

/** `…/worktrees` and `…/worktrees/<name>`: one worktree and its session, or the one to reopen. */
export function WorktreesPage({ name }: { name: string | null }) {
  return <WorktreeView key={name ?? ''} branch={name} />
}
