'use client'

import { useQuery } from '@tanstack/react-query'
import { useTaskflowProject } from '../project.tsx'

export function useAgents() {
  const { api, keys } = useTaskflowProject()
  return useQuery({ queryKey: keys.agents(), queryFn: () => api.fetchAgents(), retry: false })
}
