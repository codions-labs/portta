'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTaskflowProject } from '../project.tsx'
import type { WorktreeInfo } from '../types.ts'

const LINEAR_REFRESH_MS = 300_000

/**
 * The project's worktrees. One observer — the worktree actions — owns the
 * polling interval; everything else reads the same cache without starting
 * another timer, and a mount never refetches data that is already there.
 */
export function useWorktrees(refetchInterval: number | false = false) {
  const { api, keys } = useTaskflowProject()
  return useQuery<WorktreeInfo[]>({
    queryKey: keys.worktrees(),
    queryFn: () => api.fetchWorktrees(),
    refetchInterval,
    refetchOnMount: false,
  })
}

export function useWorktreeDiff(branch: string) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.worktreeDiff(branch),
    queryFn: () => api.fetchWorktreeDiff(branch),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/** Branch lists are cached per mode until a worktree is created, removed or merged. */
export function useAvailableBranches(includeRemote: boolean, enabled: boolean) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.availableBranches(includeRemote),
    queryFn: () => api.fetchAvailableBranches(includeRemote),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useBaseBranches(enabled: boolean) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.baseBranches(),
    queryFn: () => api.fetchBaseBranches(),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

/** Linear is asked at most every five minutes: its API is rate limited and the list changes slowly. */
export function useLinearIssues() {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.linearIssues(),
    queryFn: () => api.fetchLinearIssues(),
    staleTime: LINEAR_REFRESH_MS,
    refetchInterval: LINEAR_REFRESH_MS,
    retry: false,
  })
}
