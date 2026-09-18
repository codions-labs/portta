'use client'

import { useQuery } from '@tanstack/react-query'
import type { Repository } from 'portta-contracts'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useDiscoveredRepositories(enabled = true) {
  return useQuery({
    queryKey: keys.discoveredRepositories(),
    queryFn: api.discoveredRepositories,
    enabled,
    retry: false,
  })
}

export function useRepository(id: string, enabled = true, initialData?: Repository) {
  return useQuery({
    queryKey: keys.repository(id),
    queryFn: () => api.repository(id),
    retry: false,
    enabled,
    ...(initialData ? { initialData } : {}),
  })
}

/** The host rewrites the scan once a minute; thirty seconds of staleness is fine. */
export function useRepositoryGit(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.repositoryGit(id),
    queryFn: () => api.repositoryGit(id),
    enabled,
    staleTime: 30_000,
  })
}

export function useRepositoryCommits(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.repositoryCommits(id),
    queryFn: () => api.repositoryCommits(id),
    enabled,
    staleTime: 30_000,
  })
}

export function useRepositoryInstructions(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.repositoryInstructions(id),
    queryFn: () => api.repositoryInstructions(id),
    enabled,
    staleTime: 30_000,
  })
}

export function useRepositoryEnvironments(id: string, enabled = true) {
  return useQuery({ queryKey: keys.repositoryEnvironments(id), queryFn: () => api.repositoryEnvironments(id), enabled })
}
