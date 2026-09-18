'use client'

import { useQuery } from '@tanstack/react-query'
import { APP_DEFAULTS } from 'portta-core/taskflow/config'
import { useTaskflowProject } from '../project.tsx'
import type { AppConfig } from '../types.ts'

/** What the dashboard renders with before the project's configuration arrives, or when it cannot. */
export const DEFAULT_CONFIG: AppConfig = {
  name: '',
  multiplexer: APP_DEFAULTS.multiplexer,
  services: [],
  profiles: [],
  agents: [],
  defaultProfileName: '',
  defaultAgentId: APP_DEFAULTS.defaultAgent,
  autoName: false,
  linearCreateTicketOption: false,
  startupEnvs: {},
  linkedRepos: [],
  linearAutoCreateWorktrees: false,
  autoRemoveOnMerge: false,
  projectDir: '',
  mainBranch: '',
  branchPattern: '{type}/{slug}',
  build: { version: '', builtAt: '' },
}

export function useConfig(): AppConfig {
  const { api, keys } = useTaskflowProject()
  const query = useQuery({
    queryKey: keys.config(),
    queryFn: () => api.fetchConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return query.data ?? DEFAULT_CONFIG
}

/** The Project as Taskflow reports it: its name, main branch and worktrees. */
export function useProjectSnapshot() {
  const { api, keys } = useTaskflowProject()
  return useQuery({ queryKey: keys.snapshot(), queryFn: () => api.fetchProjectSnapshot(), retry: false })
}

/** How new branches are named when nobody names them. */
export function useAutoNameConfig() {
  const { api, keys } = useTaskflowProject()
  return useQuery({ queryKey: keys.autoName(), queryFn: () => api.fetchAutoNameConfig(), retry: false })
}
