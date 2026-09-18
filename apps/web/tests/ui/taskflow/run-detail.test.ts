import { expect, it, vi } from 'vitest'
import {
  emptyPhaseMessageKey,
  pendingPermission,
  RunDetail,
  resolvedPhaseCount,
} from '@/modules/taskflow/components/runs/run-detail'
import { emptyRunTimeline } from '@/modules/taskflow/lib/run-timeline'
import { fireEvent, render, screen } from './render.tsx'

it('describes skipped workflow phases as skipped', () => {
  expect(emptyPhaseMessageKey('skipped')).toBe('phaseSkipped')
  expect(emptyPhaseMessageKey('pending')).toBe('phaseWaiting')
})

it('counts every terminal workflow phase as resolved', () => {
  expect(resolvedPhaseCount(['failed', 'skipped', 'skipped', 'completed'])).toBe(4)
  expect(resolvedPhaseCount(['completed', 'running', 'pending', 'cancelled'])).toBe(2)
})

it('extracts the unresolved ACP permission request from the Run journal', () => {
  expect(
    pendingPermission({
      cursor: 1,
      events: [
        {
          id: 'event_01',
          runId: 'run_01',
          executionId: 'execution_01',
          sessionId: 'operation_01',
          sequence: 1,
          type: 'acp.agent.permission',
          timestamp: '2026-09-11T00:00:00.000Z',
          source: 'harness',
          payload: {
            version: 1,
            data: {
              supervisorSequence: 2,
              event: {
                requestId: '01234567-89ab-4def-8123-456789abcdef',
                request: {
                  toolCall: { title: 'Run tests' },
                  options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }],
                },
              },
            },
          },
        },
      ],
    }),
  ).toEqual({
    requestId: '01234567-89ab-4def-8123-456789abcdef',
    title: 'Run tests',
    options: [{ optionId: 'once', name: 'Allow once' }],
  })
})

it('renders only capability-backed Run actions', async () => {
  const onCancel = vi.fn()
  render(RunDetail, {
    detail: {
      run: {
        id: 'run_01',
        projectId: 'project',
        mode: 'direct',
        input: 'Fix it',
        status: 'running',
        workspacePolicy: 'run',
        workspaceStrategy: 'isolated_worktree',
        workflowSnapshot: null,
        harness: 'codex',
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
        createdAt: '2026-09-09T12:00:00.000Z',
        updatedAt: '2026-09-09T12:00:00.000Z',
        startedAt: '2026-09-09T12:00:00.000Z',
        completedAt: null,
        executions: [
          {
            id: 'execution_01',
            runId: 'run_01',
            nodeKey: 'root',
            label: 'Direct',
            phase: null,
            attempt: 1,
            harness: 'codex',
            provider: null,
            model: 'gpt-5.6-codex',
            effectiveConfig: {},
            workspaceId: 'workspace',
            input: 'Fix it',
            output: null,
            status: 'running',
            usage: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
            error: null,
            sessionId: 'pane_01',
            capabilities: { terminal: true, interactiveInput: true, interrupt: true, resume: false },
            startedAt: '2026-09-09T12:00:00.000Z',
            completedAt: null,
          },
        ],
        result: null,
        workflowProgress: null,
        artifacts: [],
      },
    },
    timeline: emptyRunTimeline(),
    onSelectExecution: vi.fn(),
    onCloseExecution: vi.fn(),
    onCancel,
    onResume: vi.fn(),
    onRespondPermission: vi.fn(),
    onOpenSession: vi.fn(),
  })

  expect(screen.getByText(/gpt-5\.6-codex/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledWith('run_01')
})
