'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchProjects } from '../api/index.ts'
import { registryKeys } from './keys.ts'

export { registryKeys }

/** The Taskflow Projects the host daemon serves. */
export function useTaskflowProjects() {
  return useQuery({ queryKey: registryKeys.projects(), queryFn: () => fetchProjects(), retry: false })
}
