import { expect, it, vi } from 'vitest'
import { RunList } from '@/modules/taskflow/components/runs/run-list'
import { fireEvent, render, screen } from './render.tsx'

it('shows Run metadata and selects a Run', async () => {
  const onSelect = vi.fn()
  render(RunList, {
    runs: [
      {
        id: 'run_01',
        projectId: 'project',
        mode: 'workflow',
        input: null,
        status: 'running',
        workspacePolicy: 'run',
        workspaceStrategy: 'isolated_worktree',
        workflowSnapshot: {
          id: 'snapshot',
          workflowId: 'review',
          name: 'Review',
          description: '',
          origin: 'project',
          path: '/review',
          contentHash: 'x',
          engineVersion: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        workspace: {
          id: 'workspace',
          strategy: 'isolated_worktree',
          path: '/work',
          branch: 'taskflow/run',
          baseBranch: 'main',
          baseCommit: 'abc',
          state: 'ready',
        },
        profile: 'default',
        error: null,
        capabilities: { cancel: true, resume: false },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      },
    ],
    onSelect,
  })
  expect(screen.getByText('Review')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button'))
  expect(onSelect).toHaveBeenCalledWith('run_01')
})

it('includes Taskflow direct sessions without inventing a durable Run', async () => {
  const onSelectSession = vi.fn()
  render(RunList, {
    runs: [],
    directSessions: [
      {
        branch: 'fix/direct',
        label: 'Fix directly',
        archived: false,
        agent: 'codex',
        mux: '✓',
        path: '/work',
        dir: '/work',
        dirty: false,
        unpushed: false,
        status: 'running',
        elapsed: '2m',
        profile: 'default',
        agentName: 'codex',
        agentLabel: 'Codex',
        agentTerminalStale: false,
        services: [],
        paneCount: 1,
        prs: [],
        linearIssue: null,
        creating: false,
        creationPhase: null,
        source: 'ui',
        oneshot: null,
        tabs: [],
        activeTabId: null,
      },
    ],
    onSelect: vi.fn(),
    onSelectSession,
  })
  expect(screen.getByText('Fix directly')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: /Fix directly/ }))
  expect(onSelectSession).toHaveBeenCalledWith('fix/direct')
})
