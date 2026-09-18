// Taskflow: parallel AI development on the host — Git worktrees, persistent
// terminal sessions, agent chat, Direct Sessions and Workflow Runs, and the
// environments they run in.
//
// Its domain lives in `portta-core/taskflow`, its contract in
// `portta-contracts/taskflow`, its runtime in `portta-host`'s
// `modules/taskflow`, its commands under `portta flow`, and its pages under the
// panel's `modules/taskflow`. This manifest is what all of those share.

import { defineModule } from './manifest.ts'

export const taskflowModule = defineModule({
  id: 'taskflow',
  name: 'Taskflow',
  permissions: {
    worktree: ['read', 'write', 'remove', 'merge'],
    terminal: ['attach'],
    run: ['read', 'create', 'cancel', 'permission'],
    workflow: ['read', 'run', 'save'],
    agent: ['read', 'write'],
    workspace: ['read', 'operate', 'trust', 'expose'],
    linear: ['read', 'write'],
  },
  roles: {
    developer: {
      worktree: ['read', 'write', 'remove', 'merge'],
      terminal: ['attach'],
      run: ['read', 'create', 'cancel', 'permission'],
      workflow: ['read', 'run', 'save'],
      agent: ['read', 'write'],
      workspace: ['read', 'operate', 'trust', 'expose'],
      linear: ['read', 'write'],
    },
    viewer: {
      worktree: ['read'],
      run: ['read'],
      workflow: ['read'],
      agent: ['read'],
      workspace: ['read'],
      linear: ['read'],
    },
  },
  activityKinds: ['worktree.created', 'worktree.removed', 'worktree.merged', 'run.started', 'run.finished'],
  docs: 'docs/modules/taskflow',
})
