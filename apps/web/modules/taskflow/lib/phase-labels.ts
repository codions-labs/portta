'use client'

import { PROJECT_CONFIG_PATH } from 'portta-core/taskflow/config'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ProjectSetupError } from './api/projects.ts'
import type { ProjectInitPhase, WorktreeCreationPhase } from './types.ts'
import { errorMessage } from './utils.ts'

const CREATION_PHASES: readonly WorktreeCreationPhase[] = [
  'creating_worktree',
  'preparing_runtime',
  'running_post_create_hook',
  'starting_session',
  'reconciling',
]

/** What a worktree that is still being created is doing, in the reader's language. */
export function useWorktreeCreationPhaseLabel(): (phase: WorktreeCreationPhase | null) => string {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'creationPhase' })
  return useCallback((phase) => (phase && CREATION_PHASES.includes(phase) ? t(phase) : t('creating')), [t])
}

const INIT_PHASES: readonly ProjectInitPhase[] = ['creating_config', 'analyzing', 'ready', 'failed']

/** What adding a project is doing, in the reader's language. */
export function useProjectInitPhaseLabel(): (phase: ProjectInitPhase | null) => string {
  const { t } = useTranslation('taskflow', { keyPrefix: 'projects.initPhase' })
  return useCallback(
    (phase) => (phase && INIT_PHASES.includes(phase) ? t(phase, { path: PROJECT_CONFIG_PATH }) : t('settingUp')),
    [t],
  )
}

/** A failed project setup in the reader's language; the server's reason is kept when it gave one. */
export function useProjectSetupErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation('taskflow', { keyPrefix: 'projects.setupError' })
  return useCallback(
    (error) => {
      if (!(error instanceof ProjectSetupError)) return errorMessage(error)
      if (error.reason === 'failed' && error.message !== 'Project setup failed.') return error.message
      return t(error.reason)
    },
    [t],
  )
}
