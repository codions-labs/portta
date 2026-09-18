import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileChatSurface } from '@/modules/taskflow/components/chat/mobile-chat-surface'
import type {
  AgentsUiConversationEvent,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
  WorktreeInfo,
} from '@/modules/taskflow/lib/types'
import { act, cleanup, fakeProjectApi, fireEvent, render, screen } from './render.tsx'

/** The Taskflow Project API every render below reads, replaced before each test. */
let api = fakeProjectApi()

async function findText(text: string): Promise<HTMLElement> {
  await act(async () => {})
  return screen.getByText(text)
}

function createWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    branch: 'feature/mobile-chat',
    label: null,
    archived: false,
    agent: 'waiting',
    mux: '✓',
    path: '/repo/__worktrees/feature/mobile-chat',
    dir: '/repo/__worktrees/feature/mobile-chat',
    dirty: false,
    unpushed: false,
    status: 'idle',
    elapsed: '1m',
    profile: null,
    agentName: 'claude',
    agentLabel: 'Claude',
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
    ...overrides,
  }
}

function createConversationResponse(
  provider: 'claudeCode' | 'codexAppServer' = 'claudeCode',
  overrides: Partial<AgentsUiWorktreeConversationResponse['conversation']> = {},
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: {
      branch: 'feature/mobile-chat',
      path: '/repo/__worktrees/feature/mobile-chat',
      archived: false,
      dirty: false,
      unpushed: false,
      status: 'idle',
      services: [],
      prs: [],
      creating: false,
      creationPhase: null,
      agentName: provider === 'claudeCode' ? 'claude' : 'codex',
      agentLabel: provider === 'claudeCode' ? 'Claude' : 'Codex',
      agentTerminalStale: false,
      profile: null,
      mux: true,
      conversation:
        provider === 'claudeCode'
          ? {
              provider: 'claudeCode',
              conversationId: 'session-1',
              cwd: '/repo/__worktrees/feature/mobile-chat',
              lastSeenAt: '2026-04-15T12:00:00.000Z',
              sessionId: 'session-1',
            }
          : {
              provider: 'codexAppServer',
              conversationId: 'thread-1',
              cwd: '/repo/__worktrees/feature/mobile-chat',
              lastSeenAt: '2026-04-15T12:00:00.000Z',
              threadId: 'thread-1',
            },
    },
    conversation: {
      provider,
      conversationId: provider === 'claudeCode' ? 'session-1' : 'thread-1',
      cwd: '/repo/__worktrees/feature/mobile-chat',
      running: false,
      activeTurnId: null,
      messages: [],
      ...overrides,
    },
  }
}

describe('MobileChatSurface', () => {
  beforeEach(() => {
    api = fakeProjectApi()
    vi.useFakeTimers()
    vi.clearAllMocks()
    api.connectWorktreeConversationStream.mockReturnValue(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('streams Claude conversations without polling history after sending', async () => {
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse('claudeCode'))
    api.sendWorktreeConversationMessage.mockResolvedValue({
      conversationId: 'session-1',
      turnId: 'turn-1',
      running: true,
      streaming: true,
    } satisfies AgentsUiSendMessageResponse)
    api.fetchWorktreeConversationHistory.mockResolvedValue(createConversationResponse('claudeCode'))

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree(),
        },
      },
      { api },
    )

    await act(async () => {})
    expect(screen.getByText('No messages yet. Send the first prompt to start this chat.')).toBeInTheDocument()
    expect(api.connectWorktreeConversationStream).not.toHaveBeenCalled()

    await fireEvent.input(screen.getByLabelText('Message'), {
      target: { value: 'Ship it' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await vi.waitFor(() => {
      expect(api.sendWorktreeConversationMessage).toHaveBeenCalledWith('feature/mobile-chat', { text: 'Ship it' })
    })
    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })
    await act(async () => {})
    expect(screen.getByText('Ship it')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5000)
    expect(api.fetchWorktreeConversationHistory).not.toHaveBeenCalled()
  })

  it('reuses one Claude stream across turns instead of reconnecting', async () => {
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse('claudeCode'))
    api.sendWorktreeConversationMessage
      .mockResolvedValueOnce({
        conversationId: 'session-1',
        turnId: 'turn-1',
        running: true,
        streaming: true,
      } satisfies AgentsUiSendMessageResponse)
      .mockResolvedValueOnce({
        conversationId: 'session-1',
        turnId: 'turn-2',
        running: true,
        streaming: true,
      } satisfies AgentsUiSendMessageResponse)

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree(),
        },
      },
      { api },
    )

    await findText('No messages yet. Send the first prompt to start this chat.')

    // Turn 1 opens the stream.
    await fireEvent.input(screen.getByLabelText('Message'), { target: { value: 'first' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await findText('first')
    expect(api.connectWorktreeConversationStream).toHaveBeenCalledTimes(1)

    // Turn 1 completes — the stream must stay open, not tear down.
    const callbacks = api.connectWorktreeConversationStream.mock.calls[0]?.[1]
    callbacks?.onEvent({
      type: 'conversationStatus',
      revision: 1,
      conversationId: 'session-1',
      running: false,
      activeTurnId: null,
    })
    await act(async () => {})

    // Turn 2 must reuse the existing stream. Reconnecting spins up a fresh
    // server-side session that reseeds ordering and interleaves turns into
    // user/user/assistant/assistant.
    await fireEvent.input(screen.getByLabelText('Message'), { target: { value: 'second' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => {
      expect(api.sendWorktreeConversationMessage).toHaveBeenCalledTimes(2)
    })

    expect(api.connectWorktreeConversationStream).toHaveBeenCalledTimes(1)
  })

  it('polls Claude history after terminal-routed sends', async () => {
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse('claudeCode'))
    api.sendWorktreeConversationMessage.mockResolvedValue({
      conversationId: 'session-1',
      turnId: 'tmux:turn-1',
      running: true,
      streaming: false,
    } satisfies AgentsUiSendMessageResponse)
    api.fetchWorktreeConversationHistory.mockResolvedValue(
      createConversationResponse('claudeCode', {
        messages: [
          {
            id: 'user-1',
            turnId: 'turn-1',
            order: 0,
            role: 'user',
            kind: 'text',
            text: 'Ship it',
            status: 'completed',
            createdAt: '2026-05-28T10:00:00.000Z',
          },
          {
            id: 'assistant-1',
            turnId: 'turn-1',
            order: 1,
            role: 'assistant',
            kind: 'text',
            text: 'Done from terminal',
            status: 'completed',
            createdAt: '2026-05-28T10:00:01.000Z',
          },
        ],
      }),
    )

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree(),
        },
      },
      { api },
    )

    await findText('No messages yet. Send the first prompt to start this chat.')

    await fireEvent.input(screen.getByLabelText('Message'), {
      target: { value: 'Ship it' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await vi.waitFor(() => {
      expect(api.sendWorktreeConversationMessage).toHaveBeenCalledWith('feature/mobile-chat', { text: 'Ship it' })
    })
    await act(async () => {})
    await vi.advanceTimersByTimeAsync(1000)

    await vi.waitFor(() => {
      expect(api.fetchWorktreeConversationHistory).toHaveBeenCalledWith('feature/mobile-chat')
    })
    await findText('Done from terminal')
  })

  it('does not poll Codex history after sending when the websocket stream is active', async () => {
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse('codexAppServer'))
    api.sendWorktreeConversationMessage.mockResolvedValue({
      conversationId: 'thread-1',
      turnId: 'turn-1',
      running: true,
      streaming: true,
    } satisfies AgentsUiSendMessageResponse)
    api.fetchWorktreeConversationHistory.mockResolvedValue(createConversationResponse('codexAppServer'))

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agentName: 'codex' }),
        },
      },
      { api },
    )

    await findText('No messages yet. Send the first prompt to start this chat.')
    expect(api.connectWorktreeConversationStream).not.toHaveBeenCalled()

    await fireEvent.input(screen.getByLabelText('Message'), {
      target: { value: 'Ship it' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })

    await findText('Ship it')
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.fetchWorktreeConversationHistory).not.toHaveBeenCalled()
  })

  it('does not open an idle Codex stream after loading the snapshot', async () => {
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse('codexAppServer'))

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agentName: 'codex' }),
        },
      },
      { api },
    )

    await findText('No messages yet. Send the first prompt to start this chat.')

    expect(api.connectWorktreeConversationStream).not.toHaveBeenCalled()
  })

  it('opens a Codex stream immediately when the snapshot is already running', async () => {
    api.attachWorktreeConversation.mockResolvedValue(
      createConversationResponse('codexAppServer', {
        running: true,
        activeTurnId: 'turn-1',
      }),
    )

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agentName: 'codex' }),
        },
      },
      { api },
    )

    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })
  })

  it('does not duplicate optimistic Codex user messages when the stream upserts the real user item', async () => {
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse('codexAppServer'))
    api.sendWorktreeConversationMessage.mockResolvedValue({
      conversationId: 'thread-1',
      turnId: 'turn-1',
      running: true,
      streaming: true,
    } satisfies AgentsUiSendMessageResponse)

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agentName: 'codex' }),
        },
      },
      { api },
    )

    await findText('No messages yet. Send the first prompt to start this chat.')

    await fireEvent.input(screen.getByLabelText('Message'), {
      target: { value: 'Ship it' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })

    const callbacks = api.connectWorktreeConversationStream.mock.calls[0]?.[1]
    callbacks?.onEvent({
      type: 'messageUpsert',
      revision: 1,
      conversationId: 'thread-1',
      message: {
        id: 'user-1',
        turnId: 'turn-1',
        order: 0,
        role: 'user',
        kind: 'text',
        text: 'Ship it',
        status: 'completed',
        createdAt: '2026-05-28T10:00:00.000Z',
      },
    })

    await vi.waitFor(() => {
      expect(screen.getAllByText('Ship it')).toHaveLength(1)
    })
  })

  it('applies Claude stream deltas', async () => {
    api.attachWorktreeConversation.mockResolvedValue(
      createConversationResponse('claudeCode', {
        running: true,
        activeTurnId: 'claude-turn:turn-1',
      }),
    )

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree(),
        },
      },
      { api },
    )

    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })

    const callbacks = api.connectWorktreeConversationStream.mock.calls[0]?.[1]
    callbacks?.onEvent({
      type: 'messageDelta',
      revision: 1,
      conversationId: 'session-1',
      turnId: 'claude-turn:turn-1',
      itemId: 'msg_1:0',
      order: 0,
      delta: 'Streaming from Claude',
    })

    await findText('Streaming from Claude')
  })

  it('ignores stale Codex stream revisions', async () => {
    api.attachWorktreeConversation.mockResolvedValue(
      createConversationResponse('codexAppServer', {
        running: true,
        activeTurnId: 'turn-1',
      }),
    )

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agentName: 'codex', agentLabel: 'Codex' }),
        },
      },
      { api },
    )

    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })

    const callbacks = api.connectWorktreeConversationStream.mock.calls[0]?.[1]
    const deltaEvent: AgentsUiConversationEvent = {
      type: 'messageDelta',
      revision: 1,
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      order: 0,
      delta: 'Streaming status update',
    }
    callbacks?.onEvent(deltaEvent)
    await findText('Streaming status update')

    const staleDeltaEvent: AgentsUiConversationEvent = {
      type: 'messageDelta',
      revision: 1,
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      order: 0,
      delta: ' stale',
    }
    callbacks?.onEvent(staleDeltaEvent)

    await findText('Streaming status update')
    await act(async () => {})
    expect(document.body.textContent).not.toContain('stale')
  })

  it('renders Codex stream events in their explicit order', async () => {
    api.attachWorktreeConversation.mockResolvedValue(
      createConversationResponse('codexAppServer', {
        running: true,
        activeTurnId: 'turn-1',
      }),
    )

    render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agentName: 'codex', agentLabel: 'Codex' }),
        },
      },
      { api },
    )

    await vi.waitFor(() => {
      expect(api.connectWorktreeConversationStream).toHaveBeenCalledWith('feature/mobile-chat', expect.any(Object))
    })

    const callbacks = api.connectWorktreeConversationStream.mock.calls[0]?.[1]
    callbacks?.onEvent({
      type: 'messageDelta',
      revision: 1,
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      order: 0,
      delta: 'First assistant',
    })
    callbacks?.onEvent({
      type: 'messageUpsert',
      revision: 2,
      conversationId: 'thread-1',
      message: {
        id: 'call-1',
        turnId: 'turn-1',
        order: 1,
        role: 'assistant',
        kind: 'toolUse',
        toolName: 'shell',
        toolCallId: 'call-1',
        text: 'pwd',
        status: 'completed',
        createdAt: '2026-05-28T10:00:01.000Z',
      },
    })
    callbacks?.onEvent({
      type: 'messageDelta',
      revision: 3,
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-2',
      order: 2,
      delta: 'Second assistant',
    })

    await findText('First assistant')
    await findText('Second assistant')

    await act(async () => {})

    expect(screen.getByText('First assistant')).toBeInTheDocument()
    expect(screen.getByText('Second assistant')).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text.indexOf('First assistant')).toBeLessThan(text.indexOf('Completed shell'))
    expect(text.indexOf('Completed shell')).toBeLessThan(text.indexOf('Second assistant'))
  })

  it('polls Claude history for a busy terminal-owned turn and stops when the agent goes idle', async () => {
    const userMessage = {
      id: 'user-1',
      turnId: 'turn-1',
      order: 0,
      role: 'user' as const,
      kind: 'text' as const,
      text: 'Build the feature',
      status: 'completed' as const,
      createdAt: '2026-05-28T10:00:00.000Z',
    }
    api.attachWorktreeConversation.mockResolvedValue(
      createConversationResponse('claudeCode', {
        running: false,
        activeTurnId: null,
        messages: [userMessage],
      }),
    )
    api.fetchWorktreeConversationHistory.mockResolvedValue(
      createConversationResponse('claudeCode', {
        running: false,
        activeTurnId: null,
        messages: [
          userMessage,
          {
            id: 'assistant-1',
            turnId: 'turn-1',
            order: 1,
            role: 'assistant',
            kind: 'text',
            text: 'Done from terminal',
            status: 'completed',
            createdAt: '2026-05-28T10:00:01.000Z',
          },
        ],
      }),
    )

    const { rerender } = render(
      MobileChatSurface,
      {
        props: {
          worktree: createWorktree({ agent: 'working', status: 'running' }),
        },
      },
      { api },
    )

    await findText('Build the feature')
    // A terminal-owned turn has no backend stream to subscribe to.
    expect(api.connectWorktreeConversationStream).not.toHaveBeenCalled()

    // Polling surfaces the terminal claude's flushed response live.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => {
      expect(api.fetchWorktreeConversationHistory).toHaveBeenCalledWith('feature/mobile-chat')
    })
    await findText('Done from terminal')

    // Polling keeps running while the agent is busy (it must not settle early).
    await vi.advanceTimersByTimeAsync(5000)
    const callsWhileBusy = api.fetchWorktreeConversationHistory.mock.calls.length
    expect(callsWhileBusy).toBeGreaterThan(1)

    // When the run settles and the agent goes idle, polling stops.
    await rerender({ worktree: createWorktree({ agent: 'waiting', status: 'idle' }) })
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.fetchWorktreeConversationHistory.mock.calls.length).toBe(callsWhileBusy)
  })
})
