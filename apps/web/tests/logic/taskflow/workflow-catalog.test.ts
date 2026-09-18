// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { WorkflowWorkspacePolicy } from '@/modules/taskflow/lib/types'
import { groupWorkflows, workflowTitle } from '@/modules/taskflow/lib/workflow-catalog'

describe('workflow catalog presentation', () => {
  it('groups workflows by their source in user-facing precedence order', () => {
    const workspace: WorkflowWorkspacePolicy = {
      default: 'isolated_worktree',
      allowed: ['isolated_worktree', 'new_branch', 'current_branch'],
      mutatesRepository: true,
    }
    const groups = groupWorkflows([
      {
        id: 'builtin:review',
        name: 'code-review',
        description: 'Review code',
        origin: 'builtin',
        path: '/builtin',
        contentHash: 'a',
        phases: [],
        availability: 'available',
        diagnostics: [],
        workspace,
      },
      {
        id: 'project:ship',
        name: 'ship-it',
        description: 'Ship a change',
        origin: 'project',
        path: '/project',
        contentHash: 'b',
        phases: [],
        availability: 'available',
        diagnostics: [],
        workspace,
      },
      {
        id: 'global:research',
        name: 'deep-research',
        description: 'Research',
        origin: 'global',
        path: '/global',
        contentHash: 'c',
        phases: [],
        availability: 'available',
        diagnostics: [],
        workspace,
      },
    ])

    expect(groups.map((group) => group.origin)).toEqual(['project', 'global', 'builtin'])
    expect(groups.map((group) => group.workflows[0]?.name)).toEqual(['ship-it', 'deep-research', 'code-review'])
  })

  it('turns a workflow slug into a readable title', () => {
    expect(workflowTitle('multi-provider_review')).toBe('Multi Provider Review')
  })
})
