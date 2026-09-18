'use client'

import { useQuery } from '@tanstack/react-query'
import { type ActivityFilters, api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useProjectActivity(slug: string, filters: ActivityFilters = {}, enabled = true) {
  return useQuery({
    queryKey: keys.activity(slug, filters),
    queryFn: () => api.projectActivity(slug, filters),
    retry: false,
    enabled,
  })
}
