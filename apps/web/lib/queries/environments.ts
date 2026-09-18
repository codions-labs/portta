'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useEnvironments(all = true) {
  return useQuery({ queryKey: keys.environments(), queryFn: () => api.environments(all) })
}

export function useEnvironment(name: string) {
  return useQuery({ queryKey: keys.environment(name), queryFn: () => api.environment(name), retry: false })
}

/** A host snapshot changes once a minute at most; thirty seconds is plenty. */
export function useEnvironmentGit(name: string) {
  return useQuery({ queryKey: keys.environmentGit(name), queryFn: () => api.environmentGit(name), staleTime: 30_000 })
}

export function useEnvironmentSettings(name: string, enabled = true) {
  return useQuery({
    queryKey: keys.environmentSettings(name),
    queryFn: () => api.environmentSettings(name),
    enabled,
    retry: false,
  })
}

export function useEnvironmentRemovalPreview(name: string) {
  return useQuery({
    queryKey: keys.environmentRemovalPreview(name),
    queryFn: () => api.environmentRemovalPreview(name),
  })
}

/**
 * The consolidated Service rows. Errors are not retried: a panel that does not
 * serve this route yet answers 404 once, and the caller falls back to what the
 * environment already carries.
 */
export function useEnvironmentServices(name: string, enabled = true) {
  return useQuery({
    queryKey: keys.environmentServices(name),
    queryFn: () => api.environmentServices(name),
    enabled,
    retry: false,
    refetchInterval: 5_000,
  })
}
