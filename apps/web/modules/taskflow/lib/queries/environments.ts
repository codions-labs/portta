'use client'

import { useQuery } from '@tanstack/react-query'
import { useTaskflowProject } from '../project.tsx'

const ENVIRONMENT_REFRESH_MS = 2_000

/** A runtime changes state on its own (building, starting), so its detail refreshes every two seconds. */
export function useEnvironment(environmentId: string) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.environment(environmentId),
    queryFn: () => api.fetchEnvironment(environmentId).then((data) => data.environment),
    refetchInterval: ENVIRONMENT_REFRESH_MS,
    retry: false,
  })
}

export function useEnvironmentServices(environmentId: string) {
  const { api, keys } = useTaskflowProject()
  return useQuery({
    queryKey: keys.environmentServices(environmentId),
    queryFn: () => api.fetchEnvironmentServices(environmentId).then((data) => data.services),
    refetchInterval: ENVIRONMENT_REFRESH_MS,
    retry: false,
  })
}
