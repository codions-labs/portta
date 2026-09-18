'use client'

import { useQueryClient } from '@tanstack/react-query'
import { SettingsView } from '../components/settings/settings-view.tsx'
import { useWorktreeActions } from '../components/worktrees/worktree-actions.tsx'
import { useTaskflowProject } from '../lib/project.tsx'
import { useConfig } from '../lib/queries/config.ts'
import type { AppConfig } from '../lib/types.ts'

/** `…/taskflow/settings`: the Project's agents, integration switches and readiness, and this browser. */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { keys } = useTaskflowProject()
  const config = useConfig()
  const { switchInterface } = useWorktreeActions()

  function patchConfig(patch: Partial<AppConfig>): void {
    queryClient.setQueryData<AppConfig>(keys.config(), (current) => (current ? { ...current, ...patch } : current))
  }

  return (
    <SettingsView
      linearAutoCreate={config.linearAutoCreateWorktrees ?? false}
      autoRemoveOnMerge={config.autoRemoveOnMerge ?? false}
      multiplexer={config.multiplexer}
      onWebChatUiChange={switchInterface}
      onLinearAutoCreateChange={(enabled) => patchConfig({ linearAutoCreateWorktrees: enabled })}
      onAutoRemoveChange={(enabled) => patchConfig({ autoRemoveOnMerge: enabled })}
      onAgentsChange={(agents) => patchConfig({ agents })}
    />
  )
}
