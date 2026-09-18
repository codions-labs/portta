import type { AgentsUiConversationState } from 'portta-contracts/taskflow'
import { describe, expect, it } from 'vitest'
import {
  buildConversationAttachmentPayload,
  buildSeedFromLinear,
  countConversationTurns,
  type ExportConversationDependencies,
  type ExportConversationInput,
  exportConversationToLinear,
  parseTaskflowConversationAttachmentPayload,
  type SeedFromLinearDependencies,
  type TaskflowConversationAttachmentPayload,
} from '../services/conversation-export-service.ts'

function makeConversation(): AgentsUiConversationState {
  return {
    provider: 'codexAppServer',
    conversationId: 'conv-1',
    cwd: '/tmp/wt/feat-foo',
    running: false,
    activeTurnId: null,
    messages: [
      {
        id: 'm1',
        turnId: 't1',
        order: 0,
        role: 'user',
        kind: 'text',
        text: 'Do the thing',
        status: 'completed',
        createdAt: '2026-05-11T10:00:00.000Z',
      },
      {
        id: 'm2',
        turnId: 't1',
        order: 1,
        role: 'assistant',
        kind: 'text',
        text: 'Did the thing',
        status: 'completed',
        createdAt: '2026-05-11T10:00:30.000Z',
      },
      {
        id: 'm3',
        turnId: 't2',
        order: 2,
        role: 'user',
        kind: 'text',
        text: 'Now the other thing',
        status: 'completed',
        createdAt: '2026-05-11T10:01:00.000Z',
      },
    ],
  }
}

function makeExportInput(overrides: Partial<ExportConversationInput> = {}): ExportConversationInput {
  return {
    target: { kind: 'issue', issueId: 'issue-id-1' },
    branch: 'feat/foo',
    baseBranch: 'main',
    agent: 'codex',
    prUrl: null,
    conversation: makeConversation(),
    now: () => new Date('2026-05-11T10:30:00.000Z'),
    ...overrides,
  }
}

describe('countConversationTurns', () => {
  it('counts unique turn ids', () => {
    expect(countConversationTurns(makeConversation())).toBe(2)
  })
})

describe('buildConversationAttachmentPayload', () => {
  it('includes the conversation messages and metadata', () => {
    const payload = buildConversationAttachmentPayload(makeExportInput())
    expect(payload.taskflow).toBe(1)
    expect(payload.branch).toBe('feat/foo')
    expect(payload.baseBranch).toBe('main')
    expect(payload.conversation).toHaveLength(3)
  })
})

describe('parseTaskflowConversationAttachmentPayload', () => {
  it('normalizes old taskflow v1 attachment messages without order or kind', () => {
    const payload = parseTaskflowConversationAttachmentPayload({
      taskflow: 1,
      branch: 'feat/foo',
      baseBranch: null,
      agent: 'codex',
      createdAt: '2026-05-11T00:00:00.000Z',
      conversation: [
        {
          id: 'm1',
          turnId: 't1',
          role: 'user',
          text: 'Old prompt',
          status: 'completed',
          createdAt: '2026-05-11T00:00:01.000Z',
        },
        {
          id: 'm2',
          turnId: 't1',
          role: 'assistant',
          text: 'Old reply',
          status: 'completed',
          createdAt: '2026-05-11T00:00:02.000Z',
        },
      ],
    })

    expect(payload?.conversation).toEqual([
      {
        id: 'm1',
        turnId: 't1',
        order: 0,
        role: 'user',
        kind: 'text',
        text: 'Old prompt',
        status: 'completed',
        createdAt: '2026-05-11T00:00:01.000Z',
      },
      {
        id: 'm2',
        turnId: 't1',
        order: 1,
        role: 'assistant',
        kind: 'text',
        text: 'Old reply',
        status: 'completed',
        createdAt: '2026-05-11T00:00:02.000Z',
      },
    ])
  })
})

describe('exportConversationToLinear', () => {
  function makeDeps(overrides: Partial<ExportConversationDependencies> = {}): {
    deps: ExportConversationDependencies
    spy: {
      attachCalls: Array<{ issueId: string; title: string; url: string }>
      commentCalls: Array<{ issueId: string; body: string }>
      uploadCalls: number
    }
  } {
    const spy = {
      attachCalls: [] as Array<{ issueId: string; title: string; url: string }>,
      commentCalls: [] as Array<{ issueId: string; body: string }>,
      uploadCalls: 0,
    }
    const deps: ExportConversationDependencies = {
      fetchIssueWithAttachments: async (id) => ({
        ok: true,
        data: {
          id,
          identifier: 'ENG-1',
          title: 't',
          description: null,
          url: 'https://linear.app/x',
          branchName: '',
          attachments: [],
        },
      }),
      fetchTeamByKey: async (key) => ({ ok: true, data: { id: `team-${key}`, key, name: 'Team' } }),
      createLinearIssue: async () => ({
        ok: true,
        data: {
          id: 'new-issue',
          identifier: 'ENG-2',
          title: 'auto',
          url: 'https://linear.app/y',
          branchName: 'auto-branch',
        },
      }),
      uploadAttachmentFile: async () => {
        spy.uploadCalls += 1
        return { ok: true, data: { assetUrl: 'https://linear.app/asset/123' } }
      },
      attachToIssue: async (input) => {
        spy.attachCalls.push({ issueId: input.issueId, title: input.title, url: input.url })
        return { ok: true, data: { id: 'att-1', url: input.url } }
      },
      createIssueComment: async (input) => {
        spy.commentCalls.push({ issueId: input.issueId, body: input.body })
        return { ok: true, data: { id: 'c-1', url: `https://linear.app/comment/${input.issueId}` } }
      },
      ...overrides,
    }
    return { deps, spy }
  }

  it('attaches and comments on an existing issue', async () => {
    const { deps, spy } = makeDeps()
    const result = await exportConversationToLinear(makeExportInput(), deps)
    expect(result.ok).toBe(true)
    expect(spy.uploadCalls).toBe(1)
    expect(spy.attachCalls[0]).toEqual({
      issueId: 'issue-id-1',
      title: 'taskflow-state:feat/foo',
      url: 'https://linear.app/asset/123',
    })
    expect(spy.commentCalls[0]!.issueId).toBe('issue-id-1')
    if (result.ok) {
      expect(result.data.issueId).toBe('issue-id-1')
      expect(result.data.attachmentUrl).toBe('https://linear.app/asset/123')
      expect(result.data.commentUrl).toBe('https://linear.app/comment/issue-id-1')
    }
  })

  it('creates a new issue when target is a team key', async () => {
    const { deps, spy } = makeDeps()
    const result = await exportConversationToLinear(
      makeExportInput({ target: { kind: 'team', teamKey: 'ENG', title: 'Custom title' } }),
      deps,
    )
    expect(result.ok).toBe(true)
    expect(spy.attachCalls[0]!.issueId).toBe('new-issue')
    if (result.ok) {
      expect(result.data.issueId).toBe('new-issue')
    }
  })

  it('still returns ok with null commentUrl when comment creation fails', async () => {
    const { deps } = makeDeps({
      createIssueComment: async () => ({ ok: false, error: 'rate limited' }),
    })
    const result = await exportConversationToLinear(makeExportInput(), deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.commentUrl).toBeNull()
      expect(result.data.attachmentUrl).toBe('https://linear.app/asset/123')
    }
  })

  it('returns the upload error when the file upload fails', async () => {
    const { deps } = makeDeps({
      uploadAttachmentFile: async () => ({ ok: false, error: 'S3 blew up' }),
    })
    const result = await exportConversationToLinear(makeExportInput(), deps)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('S3 blew up')
    }
  })
})

describe('buildSeedFromLinear', () => {
  function makeDeps(
    payload?: TaskflowConversationAttachmentPayload,
    attachmentUrl = 'https://linear.app/asset/x',
  ): SeedFromLinearDependencies {
    return {
      fetchIssueWithAttachments: async (id) => ({
        ok: true,
        data: {
          id,
          identifier: id,
          title: 't',
          description: 'Issue body here',
          url: `https://linear.app/${id}`,
          branchName: 'fallback-branch',
          attachments: payload
            ? [
                {
                  id: 'a',
                  url: attachmentUrl,
                  title: `taskflow-state:${payload.branch}`,
                  subtitle: null,
                  sourceType: null,
                  metadata: null,
                  createdAt: '2026-05-11T00:00:00.000Z',
                },
              ]
            : [],
        },
      }),
      downloadTaskflowAttachment: async () =>
        payload ? { ok: true, data: payload } : { ok: false, error: 'not found' },
    }
  }

  it('prefers a taskflow attachment over the github integration', async () => {
    const payload: TaskflowConversationAttachmentPayload = {
      taskflow: 1,
      branch: 'feat/foo',
      baseBranch: 'main',
      agent: 'codex',
      createdAt: '2026-05-11T00:00:00.000Z',
      conversation: makeConversation().messages,
    }
    const result = await buildSeedFromLinear({ issueId: 'ENG-1' }, makeDeps(payload))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.source).toBe('taskflow-attachment')
      expect(result.data.branch).toBe('feat/foo')
      expect(result.data.conversationMarkdown).toContain('Do the thing')
    }
  })

  it('falls through to github integration when no taskflow attachment', async () => {
    const deps: SeedFromLinearDependencies = {
      fetchIssueWithAttachments: async (id) => ({
        ok: true,
        data: {
          id,
          identifier: id,
          title: 't',
          description: null,
          url: `https://linear.app/${id}`,
          branchName: '',
          attachments: [
            {
              id: 'pr1',
              url: 'https://github.com/org/repo/pull/12',
              title: 'PR 12',
              subtitle: null,
              sourceType: 'github',
              metadata: { state: 'open', branchName: 'feat/foo' },
              createdAt: '2026-05-10T00:00:00.000Z',
            },
          ],
        },
      }),
      downloadTaskflowAttachment: async () => ({ ok: false, error: 'n/a' }),
    }
    const result = await buildSeedFromLinear({ issueId: 'ENG-2' }, deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.source).toBe('github-integration')
      expect(result.data.branch).toBe('feat/foo')
      expect(result.data.prUrl).toBe('https://github.com/org/repo/pull/12')
    }
  })

  it('returns source=none when neither is present, but still includes the issue body', async () => {
    const result = await buildSeedFromLinear({ issueId: 'ENG-3' }, makeDeps())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.source).toBe('none')
      expect(result.data.branch).toBe('fallback-branch')
      expect(result.data.conversationMarkdown).toContain('ENG-3')
      expect(result.data.conversationMarkdown).toContain('Issue body here')
      expect(result.data.conversationMarkdown).toContain('Fixes ENG-3')
    }
  })

  it('includes the Linear hint and issue header even with a taskflow attachment', async () => {
    const payload: TaskflowConversationAttachmentPayload = {
      taskflow: 1,
      branch: 'feat/foo',
      baseBranch: 'main',
      agent: 'codex',
      createdAt: '2026-05-11T00:00:00.000Z',
      conversation: makeConversation().messages,
    }
    const result = await buildSeedFromLinear({ issueId: 'ENG-4' }, makeDeps(payload))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.conversationMarkdown).toContain('ENG-4')
      expect(result.data.conversationMarkdown).toContain('Fixes ENG-4')
      expect(result.data.conversationMarkdown).toContain('Do the thing')
    }
  })
})
