// Taskflow's half in the panel UI: where it appears and what it says.
//
// The pages themselves are App Router files under `app/(panel)` that render the
// containers in `containers/`; everything they reach — the API, the queries,
// the components — stays inside this directory.

import { GitBranch } from 'lucide-react'
import { taskflowModule } from 'portta-core/modules'
import type { WebModule } from '../index.ts'
import enTaskflow from './messages/en/taskflow.json' with { type: 'json' }
import enTaskflowRuns from './messages/en/taskflow-runs.json' with { type: 'json' }
import enTaskflowWorktrees from './messages/en/taskflow-worktrees.json' with { type: 'json' }
import ptTaskflow from './messages/pt-BR/taskflow.json' with { type: 'json' }
import ptTaskflowRuns from './messages/pt-BR/taskflow-runs.json' with { type: 'json' }
import ptTaskflowWorktrees from './messages/pt-BR/taskflow-worktrees.json' with { type: 'json' }

export const taskflowWebModule = {
  manifest: taskflowModule,
  nav: [
    {
      group: 'groups.development',
      href: '/taskflow',
      labelKey: 'taskflow:module.name',
      icon: GitBranch,
      permission: 'worktree:read',
    },
  ],
  projectTabs: [
    // The module's settings are the Worktrees tab's too: they sit in the same frame.
    {
      id: 'worktrees',
      labelKey: 'taskflow:shell.nav.worktrees',
      path: 'worktrees',
      permission: 'worktree:read',
      aliases: ['taskflow'],
    },
    { id: 'runs', labelKey: 'taskflow:shell.nav.runs', path: 'runs', permission: 'run:read' },
    { id: 'workflows', labelKey: 'taskflow:shell.nav.workflows', path: 'workflows', permission: 'workflow:read' },
  ],
  settingsSections: [
    { id: 'taskflow', href: '/settings/taskflow', labelKey: 'taskflow:preferences.title', permission: 'worktree:read' },
  ],
  messages: {
    en: { taskflow: enTaskflow, 'taskflow-worktrees': enTaskflowWorktrees, 'taskflow-runs': enTaskflowRuns },
    'pt-BR': { taskflow: ptTaskflow, 'taskflow-worktrees': ptTaskflowWorktrees, 'taskflow-runs': ptTaskflowRuns },
  },
} as const satisfies WebModule
