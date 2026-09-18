import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsView } from '@/modules/taskflow/components/settings/settings-view'
import type { AgentDetails, AgentSummary, AppConfig } from '@/modules/taskflow/lib/types'
import { cleanup, fakeProjectApi, fireEvent, render, screen, waitFor } from './render.tsx'

/** The Taskflow Project API every render below reads, replaced before each test. */
let api = fakeProjectApi()

const originalDialogShowModal = HTMLDialogElement.prototype.showModal
const originalDialogClose = HTMLDialogElement.prototype.close

function createAgentDetails(overrides: Partial<AgentDetails> = {}): AgentDetails {
  return {
    id: 'gemini',
    label: 'Gemini CLI',
    kind: 'custom',
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: true,
    },
    startCommand: 'gemini --prompt "${PROMPT}"',
    resumeCommand: 'gemini resume --branch "${BRANCH}"',
    ...overrides,
  }
}

function createAgentSummary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: 'gemini',
    label: 'Gemini CLI',
    kind: 'custom',
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: true,
    },
    ...overrides,
  }
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    name: 'repo',
    services: [],
    profiles: [{ name: 'default' }],
    agents: [],
    defaultProfileName: 'default',
    defaultAgentId: 'claude',
    autoName: false,
    linearCreateTicketOption: false,
    startupEnvs: {},
    linkedRepos: [],
    linearAutoCreateWorktrees: false,
    autoRemoveOnMerge: false,
    multiplexer: 'tmux' as const,
    projectDir: '/repo',
    mainBranch: 'main',
    branchPattern: '{type}/{slug}',
    build: { version: '0.1.0', builtAt: '2026-09-11T17:30:00.000Z' },
    ...overrides,
  }
}

function renderDialog() {
  return render(
    SettingsView,
    {
      linearAutoCreate: false,
      autoRemoveOnMerge: false,
      multiplexer: 'tmux' as const,
      onWebChatUiChange: vi.fn(),
      onLinearAutoCreateChange: vi.fn(),
      onAutoRemoveChange: vi.fn(),
      onAgentsChange: vi.fn(),
    },
    { api },
  )
}

describe('SettingsView agent management', () => {
  beforeEach(() => {
    api = fakeProjectApi()
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open')
    }
  })

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalDialogShowModal
    HTMLDialogElement.prototype.close = originalDialogClose
    cleanup()
    vi.clearAllMocks()
  })

  it('shows only custom agents in the list', async () => {
    api.fetchAgents.mockResolvedValue([
      createAgentDetails({
        id: 'claude',
        label: 'Claude',
        kind: 'builtin',
        startCommand: null,
        resumeCommand: null,
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      }),
      createAgentDetails(),
    ])

    renderDialog()

    await screen.findByText('Gemini CLI')
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
    expect(screen.getByText('gemini --prompt "${PROMPT}"')).toBeInTheDocument()
  })

  it('reports web chat UI preference changes', async () => {
    const onWebChatUiChange = vi.fn()
    api.fetchAgents.mockResolvedValue([])

    render(
      SettingsView,
      {
        linearAutoCreate: false,
        autoRemoveOnMerge: false,
        multiplexer: 'tmux' as const,
        onWebChatUiChange,
        onLinearAutoCreateChange: vi.fn(),
        onAutoRemoveChange: vi.fn(),
        onAgentsChange: vi.fn(),
      },
      { api },
    )

    await fireEvent.click(screen.getByRole('switch', { name: 'Use web chat UI' }))

    expect(onWebChatUiChange).toHaveBeenCalledWith(true)
  })

  it('shows an empty state when no custom agents are configured', async () => {
    api.fetchAgents.mockResolvedValue([
      createAgentDetails({
        id: 'claude',
        label: 'Claude',
        kind: 'builtin',
        startCommand: null,
        resumeCommand: null,
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      }),
    ])

    renderDialog()

    expect(await screen.findByText('No custom agents setup')).toBeInTheDocument()
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })

  it('validates, creates, and deletes custom agents', async () => {
    const onAgentsChange = vi.fn()
    api.fetchAgents.mockResolvedValueOnce([]).mockResolvedValueOnce([createAgentDetails()]).mockResolvedValueOnce([])
    api.createAgent.mockResolvedValue({ agent: createAgentDetails() })
    api.validateAgent.mockResolvedValue({ normalizedId: 'gemini-cli', warnings: [] })
    api.deleteAgent.mockResolvedValue()
    api.fetchConfig
      .mockResolvedValueOnce(createConfig({ agents: [createAgentSummary()] }))
      .mockResolvedValueOnce(createConfig({ agents: [] }))

    render(
      SettingsView,
      {
        linearAutoCreate: false,
        autoRemoveOnMerge: false,
        multiplexer: 'tmux' as const,
        onWebChatUiChange: vi.fn(),
        onLinearAutoCreateChange: vi.fn(),
        onAutoRemoveChange: vi.fn(),
        onAgentsChange,
      },
      { api },
    )

    await screen.findByText('Add agent')
    await fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
    await fireEvent.input(screen.getByLabelText('Agent name'), { target: { value: 'Gemini CLI' } })
    await fireEvent.input(screen.getByLabelText('Start command'), { target: { value: 'gemini --prompt "${PROMPT}"' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Test' }))

    await waitFor(() => {
      expect(api.validateAgent).toHaveBeenCalledWith({
        label: 'Gemini CLI',
        startCommand: 'gemini --prompt "${PROMPT}"',
      })
    })
    expect(await screen.findByText('Configuration looks good.')).toBeInTheDocument()

    await fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)

    await waitFor(() => {
      expect(api.createAgent).toHaveBeenCalledWith({
        label: 'Gemini CLI',
        startCommand: 'gemini --prompt "${PROMPT}"',
      })
    })
    await waitFor(() => {
      expect(onAgentsChange).toHaveBeenCalledWith([createAgentSummary()])
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(api.deleteAgent).toHaveBeenCalledWith('gemini')
    })
    await waitFor(() => {
      expect(onAgentsChange).toHaveBeenCalledWith([])
    })
  })
})
