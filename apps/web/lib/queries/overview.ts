'use client'

import { useQuery } from '@tanstack/react-query'
import type { DevelopmentOverview } from 'portta-contracts'
import { api } from '../api/index.ts'
import { type HostMode, hostAccess } from '../host-access.ts'
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

/** The live hostnames in one state of access. Only a public host has any of these. */
function useHostsIn(mode: HostMode): string[] {
  const mayRead = useCan('access:read')
  const exposure = useExposure(mayRead)
  const environments = useEnvironments(true)
  if (!exposure.data?.enforced) return []
  const hosts = (environments.data ?? [])
    .filter((environment) => environment.presence === 'live')
    .flatMap((environment) =>
      environment.urls
        .filter((route) => hostAccess(environment, route.host, exposure.data) === mode)
        .map((route) => route.host.toLowerCase()),
    )
  return [...new Set(hosts)]
}

/** A hostname with no entry answers nobody, and that is a decision somebody still has to make. */
export function useClosedHosts(): string[] {
  return useHostsIn('closed')
}

/** Routed around the login: these answer everybody, whatever the registry says. */
export function useUnprotectedHosts(): string[] {
  const hosts = useHostsIn('unprotected')
  const mayRead = useCan('access:read')
  const exposure = useExposure(mayRead)
  // A router with no address to list still answers, so it is named instead.
  return [...hosts, ...(exposure.data?.openRouters.names ?? [])]
}
