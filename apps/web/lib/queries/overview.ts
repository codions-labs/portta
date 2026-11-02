'use client'

import { useQuery } from '@tanstack/react-query'
import type { DevelopmentOverview } from 'portta-contracts'
import { api } from '../api/index.ts'
import { useCan } from '../permissions.ts'
import { useEnvironments } from './environments.ts'
import { useExposure } from './infra.ts'
import { keys } from './keys.ts'

/**
 * The dashboard, refreshed as often as the metrics it carries.
 *
 * `initialData` is what the Server Component already read: the first paint
 * carries the real dashboard rather than a spinner, and the first refetch
 * happens on the interval like every one after it.
 */
export function useDevelopmentOverview(initialData?: DevelopmentOverview, enabled = true) {
  return useQuery({
    queryKey: keys.developmentOverview(),
    queryFn: api.developmentOverview,
    retry: false,
    enabled,
    refetchInterval: 15_000,
    ...(initialData ? { initialData } : {}),
  })
}

/**
 * The hostnames nobody decided about. On a public host a hostname with no entry
 * answers nobody, and that is a decision somebody still has to make; elsewhere
 * it means nothing, so the list is empty.
 */
export function useClosedHosts(): string[] {
  const mayRead = useCan('access:read')
  const exposure = useExposure(mayRead)
  const environments = useEnvironments(true)
  if (!exposure.data?.enforced) return []
  const decided = new Set(exposure.data.entries.map((entry) => entry.host.toLowerCase()))
  const hosts = (environments.data ?? [])
    .filter((environment) => environment.presence === 'live')
    .flatMap((environment) => environment.urls.map((route) => route.host.toLowerCase()))
  return [...new Set(hosts)].filter((host) => !decided.has(host))
}
