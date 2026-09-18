import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunForm } from '@/modules/taskflow/components/workflows/workflow-run-form'
import type { WorkflowWorkspacePolicy } from '@/modules/taskflow/lib/types'
import { cleanup, fireEvent, render, screen } from './render.tsx'

const originalCrypto = globalThis.crypto

function renderForm(onCreate = vi.fn()): void {
  const workspace: WorkflowWorkspacePolicy = {
    default: 'isolated_worktree',
    allowed: ['isolated_worktree', 'new_branch', 'current_branch'],
    mutatesRepository: true,
  }
  render(WorkflowRunForm, {
    workflows: [
      {
        id: 'project:release',
        name: 'release-check',
        description: 'Check a release before it ships',
        origin: 'project',
        path: '/project/release.js',
        contentHash: 'project',
        phases: [{ key: '1', label: 'Inspect' }],
        availability: 'available',
        diagnostics: [],
        workspace,
      },
      {
        id: 'global:research',
        name: 'deep-research',
        description: 'Research a technical question',
        origin: 'global',
        path: '/global/research.js',
        contentHash: 'global',
        phases: [],
        availability: 'available',
        diagnostics: [],
        workspace,
      },
      {
        id: 'builtin:review',
        name: 'code-review',
        description: 'Review a code change',
        origin: 'builtin',
        path: '/builtin/review.js',
        contentHash: 'builtin',
        phases: [],
        availability: 'available',
        diagnostics: [],
        workspace,
      },
    ],
    profiles: [{ name: 'default' }],
    defaultProfileName: 'default',
    onCreate,
    onCancel: vi.fn(),
  })
}

describe('WorkflowRunForm', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'run-key' } })
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto })
  })

  it('groups the catalog by source and starts the selected workflow', async () => {
    const onCreate = vi.fn()
    renderForm(onCreate)

    expect(screen.getByRole('heading', { name: 'Project' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Global' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeTruthy()
    expect(screen.getByText('Check a release before it ships')).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Interactive' })).toBeNull()

    await fireEvent.click(screen.getByText('Release Check'))
    await fireEvent.input(screen.getByLabelText('Run input'), { target: { value: 'Check release candidate' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Start workflow' }))

    expect(onCreate).toHaveBeenCalledWith({
      mode: 'workflow',
      workflowId: 'project:release',
      input: 'Check release candidate',
      workspace: { strategy: 'isolated_worktree' },
      profile: 'default',
      transport: 'native',
      permissionMode: 'workspace',
      mcpServers: [],
      idempotencyKey: 'run-key',
    })
  })
})
