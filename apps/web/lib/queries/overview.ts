'use client'

import { useQuery } from '@tanstack/react-query'
import type { DevelopmentOverview } from 'portta-contracts'
import { api } from '../api/index.ts'
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
