'use client'

import { useQuery } from '@tanstack/react-query'
import { useTaskflowProject } from '../project.tsx'

export function useWorkflows(enabled = true) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.workflows(),
    queryFn: () => api.fetchWorkflows().then((data) => data.workflows),
    enabled,
    retry: false,
  })
}

export function useRunWorkspaceContext(enabled: boolean) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.runWorkspaceContext(),
    queryFn: () => api.fetchRunWorkspaceContext(),
    enabled,
    retry: false,
  })
}

export function useRuns(enabled = true) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.runs(),
    queryFn: () => api.fetchRuns().then((data) => data.runs),
    enabled,
    retry: false,
  })
}

export function useRun(runId: string | null) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.run(runId ?? ''),
    queryFn: () => api.fetchRun(runId ?? ''),
    enabled: runId !== null,
    retry: false,
  })
}
