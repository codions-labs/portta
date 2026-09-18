import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentsUiWorktreeConversationResponse,
  AppConfig,
  AppNotification,
  LinearIssuesResponse,
  RunDetailResponse,
  RunEvent,
  RunListResponse,
  WorktreeInfo,
} from '@/modules/taskflow/lib/types'
import { act, cleanup, fireEvent, openMenu, render, screen, waitFor, within } from './render.tsx'

const { MockFitAddon, MockTerminal, MockWebSocket } = vi.hoisted(() => {
  class MockFitAddon {
    static instances: MockFitAddon[] = []

    fit = vi.fn()

    constructor() {
      MockFitAddon.instances.push(this)
    }
  }

  class MockTerminal {
    static instances: MockTerminal[] = []

    options: { theme?: unknown } = {}
    cols = 80
    rows = 24
    modes = { mouseTrackingMode: 'none' }
    parser = { registerOscHandler: vi.fn(() => true) }
    loadAddon = vi.fn()
    onSelectionChange = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    focus = vi.fn()
    writeln = vi.fn()
    write = vi.fn()
    clearSelection = vi.fn()
    dispose = vi.fn()

    constructor(_options: unknown) {
      MockTerminal.instances.push(this)
    }

    open(container: HTMLElement): void {
      const xterm = document.createElement('div')
      xterm.className = 'xterm'
      const viewport = document.createElement('div')
      viewport.className = 'xterm-viewport'
      xterm.appendChild(viewport)
      container.appendChild(xterm)
    }

    onData(_handler: (data: string) => void): void {}

    getSelection(): string {
      return ''
    }

    hasSelection(): boolean {
      return false
    }
  }

  class MockWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static instances: MockWebSocket[] = []

    readonly url: string
    readyState = MockWebSocket.CONNECTING
    sent: string[] = []
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    constructor(url: string | URL) {
      this.url = String(url)
      MockWebSocket.instances.push(this)
    }

    send(data: string): void {
      this.sent.push(data)
    }

    close(): void {
      this.readyState = MockWebSocket.CLOSED
    }
  }

  return { MockFitAddon, MockTerminal, MockWebSocket }
})

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}))
vi.mock('@/modules/taskflow/components/environments/environment-panel', () => ({
  EnvironmentPanel: ({ environmentId }: { environmentId: string }) => `Environment ${environmentId}`,
}))

// Next's router, as a tiny store: a navigation changes the path and every
// reader of `usePathname` renders again, which is what the pages under test
// react to.
const router = vi.hoisted(() => {
  let path = '/projects/shop/worktrees'
  const listeners = new Set<() => void>()
  return {
    get: () => path,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    go(href: string) {
      path = href
      for (const listener of listeners) listener()
    },
    push: vi.fn(),
    replace: vi.fn(),
  }
})

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    usePathname: () => useSyncExternalStore(router.subscribe, router.get, router.get),
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({
      push: (href: string) => {
        router.push(href)
        router.go(href)
      },
      replace: (href: string) => {
        router.replace(href)
        router.go(href)
      },
      back: () => undefined,
      refresh: () => undefined,
      prefetch: () => undefined,
    }),
    notFound: () => {
      throw new Error('notFound')
    },
  }
})

import { usePathname } from 'next/navigation'
import { TaskflowWorkspace } from '@/modules/taskflow/components/workspace/workspace'
import { RunPage, RunsPage } from '@/modules/taskflow/containers/runs-page'
import { SettingsPage } from '@/modules/taskflow/containers/settings-page'
import { WorkflowPage, WorkflowsPage } from '@/modules/taskflow/containers/workflows-page'
import { WorktreesPage } from '@/modules/taskflow/containers/worktrees-page'
import { taskflowLocation } from '@/modules/taskflow/lib/navigation'
import { WEB_CHAT_UI_STORAGE_KEY } from '@/modules/taskflow/lib/utils'
import { fakeProjectApi } from './render.tsx'

/** The page the App Router would render for the current path, inside the frame the layout renders. */
function CurrentPage() {
  const { section, id } = taskflowLocation(usePathname(), 'shop')
  if (section === 'runs') return id ? <RunPage id={id} /> : <RunsPage />
  if (section === 'workflows') return id ? <WorkflowPage id={id} /> : <WorkflowsPage />
  if (section === 'settings') return <SettingsPage />
  return <WorktreesPage name={id} />
}

function App() {
  return (
    <TaskflowWorkspace>
      <CurrentPage />
    </TaskflowWorkspace>
  )
}

/** The Taskflow Project API every render below reads, replaced before each test. */
let api = fakeProjectApi()

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

// biome-ignore lint/complexity/noStaticOnlyClass: stands in for the global Notification constructor, which the code calls with new
class MockNotification {
  static permission: NotificationPermission = 'denied'

  static requestPermission = vi.fn(async () => 'denied' as const)
}

const originalMatchMedia = window.matchMedia
const originalNotification = globalThis.Notification
const originalDialogShowModal = HTMLDialogElement.prototype.showModal
const originalDialogClose = HTMLDialogElement.prototype.close
const originalWebSocket = globalThis.WebSocket
const originalResizeObserver = globalThis.ResizeObserver
const originalRequestAnimationFrame = globalThis.requestAnimationFrame

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    name: 'repo',
    services: [],
    startupEnvs: {},
    profiles: [{ name: 'default' }],
    agents: [
      {
        id: 'claude',
        label: 'Claude',
        kind: 'builtin',
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      },
      {
        id: 'codex',
        label: 'Codex',
        kind: 'builtin',
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      },
    ],
    defaultProfileName: 'default',
    defaultAgentId: 'claude',
    autoName: false,
    linearCreateTicketOption: false,
    linkedRepos: [],
    linearAutoCreateWorktrees: false,
    autoRemoveOnMerge: false,
    projectDir: '/repo',
    mainBranch: 'main',
    branchPattern: '{type}/{slug}',
    build: { version: '0.1.0', builtAt: '2026-09-11T17:30:00.000Z' },
    multiplexer: 'tmux' as const,
    ...overrides,
  }
}

function createWorktree(branch: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    branch,
    label: null,
    archived: false,
    agent: 'waiting',
    mux: '',
    path: `/repo/__worktrees/${branch}`,
    dir: `/repo/__worktrees/${branch}`,
    dirty: false,
    unpushed: false,
    status: 'idle',
    elapsed: '1m',
    profile: null,
    agentName: null,
    agentLabel: null,
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

function createLinearIssuesResponse(overrides: Partial<LinearIssuesResponse> = {}): LinearIssuesResponse {
  return {
    availability: 'ready',
    issues: [],
    ...overrides,
  }
}

function createConversationResponse(worktree: WorktreeInfo): AgentsUiWorktreeConversationResponse {
  return {
    worktree: {
      branch: worktree.branch,
      path: worktree.path,
      archived: worktree.archived,
      profile: worktree.profile,
      agentName: worktree.agentName,
      agentLabel: worktree.agentLabel,
      agentTerminalStale: worktree.agentTerminalStale,
      mux: worktree.mux === '✓',
      status: worktree.status,
      dirty: worktree.dirty,
      unpushed: worktree.unpushed,
      services: worktree.services,
      prs: worktree.prs,
      creating: worktree.creating,
      creationPhase: worktree.creationPhase,
      conversation: null,
    },
    conversation: {
      provider: worktree.agentName === 'codex' ? 'codexAppServer' : 'claudeCode',
      conversationId: worktree.agentName === 'codex' ? 'thread-1' : 'session-1',
      cwd: worktree.path,
      running: false,
      activeTurnId: null,
      messages: [],
    },
  }
}

function createAppNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1,
    branch: 'feature/toast',
    type: 'runtime_error',
    message: 'Notification text',
    url: 'https://example.com/notifications/1',
    timestamp: Date.UTC(2026, 3, 9, 11, 30, 0),
    ...overrides,
  }
}

function setupBrowserMocks(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: MockNotification,
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: MockWebSocket,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
  })
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement): void {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement): void {
    this.open = false
  })
}

function restoreBrowserMocks(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  })
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: originalNotification,
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: originalWebSocket,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: originalResizeObserver,
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: originalRequestAnimationFrame,
  })
  HTMLDialogElement.prototype.showModal = originalDialogShowModal
  HTMLDialogElement.prototype.close = originalDialogClose
}

async function openCreateDialogAndSubmit(branch: string): Promise<void> {
  await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
  await screen.findByRole('heading', { name: 'New run' })
  await fireEvent.input(screen.getByLabelText(/Branch name/i), {
    target: { value: branch },
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Create' }))
}

async function openCreateDialogWithBaseAndSubmit(branch: string, baseBranch: string): Promise<void> {
  await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
  await screen.findByRole('heading', { name: 'New run' })
  await fireEvent.input(screen.getByLabelText(/Branch name/i), {
    target: { value: branch },
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Base branch' }))
  await fireEvent.click(await screen.findByRole('button', { name: baseBranch }))
  await fireEvent.click(screen.getByRole('button', { name: 'Create' }))
}

describe('App create selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockTerminal.instances = []
    MockFitAddon.instances = []
    MockWebSocket.instances = []
    cleanup()
    localStorage.clear()
    api = fakeProjectApi({
      fetchAgents: async () => [],
      fetchRuns: async () => ({ runs: [] }),
      fetchRunEvents: async () => ({ events: [], nextCursor: null }),
      connectRunEventStream: () => () => {},
      connectExecutionTranscriptStream: () => () => {},
      fetchWorkflows: async () => ({ workflows: [] }),
      fetchRunWorkspaceContext: async () => ({
        path: '/repo',
        branch: 'main',
        headCommit: 'abc123',
        dirty: false,
        activeReaders: 0,
        activeWriterRunId: null,
      }),
    })
    router.go('/projects/shop/worktrees')
    setupBrowserMocks()

    api.fetchConfig.mockResolvedValue(createConfig())
    api.fetchWorktrees.mockResolvedValue([])
    api.fetchAvailableBranches.mockResolvedValue([])
    api.fetchBaseBranches.mockResolvedValue([])
    api.fetchLinearIssues.mockResolvedValue(createLinearIssuesResponse())
    api.fetchWorktreeDiff.mockResolvedValue({
      uncommitted: '',
      uncommittedTruncated: false,
      gitStatus: '',
      unpushedCommits: [],
    })
    api.subscribeNotifications.mockReturnValue(() => {})
    api.openWorktree.mockResolvedValue(undefined)
    api.closeWorktree.mockResolvedValue(undefined)
    api.removeWorktree.mockResolvedValue(undefined)
    api.setWorktreeArchived.mockResolvedValue(undefined)
    api.mergeWorktree.mockResolvedValue(undefined)
    api.pullMain.mockResolvedValue({ status: 'updated' })
    api.dismissNotification.mockResolvedValue(undefined)
    api.fetchCiLogs.mockResolvedValue('')
    api.sendWorktreePrompt.mockResolvedValue(undefined)
    api.connectWorktreeConversationStream.mockReturnValue(() => {})
    api.refreshWorktreeAgentTerminal.mockResolvedValue(undefined)
    api.setWorktreeLabel.mockResolvedValue(null)
    api.setWorktreeProfile.mockResolvedValue({ profile: 'full', restarted: true })
    api.postWorktreeToLinear.mockResolvedValue({
      ok: true,
      issueId: 'ENG-42',
      issueUrl: 'https://linear.app/example/issue/ENG-42',
      commentUrl: null,
      attachmentUrl: 'https://linear.app/attachment/x',
    })
  })

  afterEach(() => {
    cleanup()
    restoreBrowserMocks()
  })

  it('renders the environment panel for a worktree with an environment', async () => {
    api.fetchWorktrees.mockResolvedValue([createWorktree('feature/runtime', { environmentId: 'env_runtime' })])

    render(App, undefined, { api })

    expect(await screen.findByText('Environment env_runtime')).toBeInTheDocument()
  })

  it('keeps the current selection when a new worktree is created from an existing selection', async () => {
    const existingWorktree = createWorktree('main')
    const creatingWorktree = createWorktree('feature/new', {
      creating: true,
      creationPhase: 'creating_worktree',
    })
    const newWorktree = createWorktree('feature/new')
    const createResult = deferred<{ primaryBranch: string; branches: string[] }>()

    api.fetchWorktrees
      .mockResolvedValueOnce([existingWorktree])
      .mockResolvedValueOnce([existingWorktree, creatingWorktree])
      .mockResolvedValueOnce([existingWorktree, newWorktree])
      .mockResolvedValue([existingWorktree, newWorktree])
    api.createWorktree.mockReturnValueOnce(createResult.promise)

    render(App, undefined, { api })

    await screen.findByTitle('main')

    await openCreateDialogAndSubmit('feature/new')

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole('button', { name: /^feature\/new(?![-/])/i })).toBeInTheDocument()
    expect(screen.getByTitle('main')).toBeInTheDocument()
    expect(screen.queryByTitle('feature/new')).not.toBeInTheDocument()

    createResult.resolve({ primaryBranch: 'feature/new', branches: ['feature/new'] })

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(3)
    })
    expect(screen.getByTitle('main')).toBeInTheDocument()
    expect(screen.queryByTitle('feature/new')).not.toBeInTheDocument()
  })

  it('selects the new worktree when nothing was selected before creation', async () => {
    const creatingWorktree = createWorktree('feature/new', {
      creating: true,
      creationPhase: 'creating_worktree',
    })
    const newWorktree = createWorktree('feature/new')
    const createResult = deferred<{ primaryBranch: string; branches: string[] }>()

    api.fetchWorktrees
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([creatingWorktree])
      .mockResolvedValueOnce([newWorktree])
      .mockResolvedValue([newWorktree])
    api.createWorktree.mockReturnValueOnce(createResult.promise)

    render(App, undefined, { api })

    await screen.findByText('Select a worktree')

    await openCreateDialogAndSubmit('feature/new')
    createResult.resolve({ primaryBranch: 'feature/new', branches: ['feature/new'] })

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(3)
    })
    expect(screen.getByTitle('feature/new')).toBeInTheDocument()
  })

  it('shows an error toast when worktree creation fails', async () => {
    api.fetchWorktrees.mockResolvedValue([])
    api.createWorktree.mockRejectedValueOnce(new Error('branch exists'))

    render(App, undefined, { api })

    await screen.findByText('Select a worktree')
    await openCreateDialogAndSubmit('feature/new')

    const toast = await screen.findByRole('alert')
    expect(toast).toHaveTextContent('Failed to create: branch exists')
  })

  it('dismisses notification toasts through the notification API', async () => {
    let onNotification: ((notification: AppNotification) => void) | undefined

    api.fetchWorktrees.mockResolvedValue([])
    api.subscribeNotifications.mockImplementation((handlers) => {
      onNotification = handlers.onNotification
      return () => {}
    })

    render(App, undefined, { api })

    await screen.findByText('Select a worktree')
    onNotification?.(createAppNotification({ id: 42, message: 'Background error' }))

    const toast = await screen.findByRole('alert')
    await fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))

    expect(api.dismissNotification).toHaveBeenCalledWith(42)
  })

  it('shows a success toast when pulling main succeeds', async () => {
    api.fetchConfig.mockResolvedValue(
      createConfig({
        projectDir: '/repo',
        mainBranch: 'main',
      }),
    )
    api.fetchWorktrees.mockResolvedValue([])
    api.pullMain.mockResolvedValueOnce({ status: 'updated' })

    render(App, undefined, { api })

    await screen.findByText('Select a worktree')
    await screen.findByText('main')
    await fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pull' }))

    expect(api.pullMain).toHaveBeenCalledWith({})
    expect(await screen.findByRole('status')).toHaveTextContent('Pulled latest "main" from remote')
  })

  it('selects the primary paired worktree when Both is created without a prior selection', async () => {
    const creatingClaude = createWorktree('claude-feature/new', {
      creating: true,
      creationPhase: 'creating_worktree',
    })
    const creatingCodex = createWorktree('codex-feature/new', {
      creating: true,
      creationPhase: 'creating_worktree',
    })
    const createdClaude = createWorktree('claude-feature/new')
    const createdCodex = createWorktree('codex-feature/new')
    const createResult = deferred<{ primaryBranch: string; branches: string[] }>()

    api.fetchWorktrees
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([creatingClaude, creatingCodex])
      .mockResolvedValueOnce([createdClaude, createdCodex])
      .mockResolvedValue([createdClaude, createdCodex])
    api.createWorktree.mockReturnValueOnce(createResult.promise)

    render(App, undefined, { api })

    await screen.findByText('Select a worktree')

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })
    await fireEvent.click(screen.getByRole('switch', { name: /enable multiple agent selection/i }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }))
    await fireEvent.input(screen.getByLabelText(/Branch name/i), {
      target: { value: 'feature/new' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    createResult.resolve({
      primaryBranch: 'claude-feature/new',
      branches: ['claude-feature/new', 'codex-feature/new'],
    })

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(3)
    })
    expect(screen.getByTitle('claude-feature/new')).toBeInTheDocument()
  })

  it('hides archived worktrees until the archived toggle is enabled', async () => {
    api.fetchWorktrees.mockResolvedValue([
      createWorktree('feature/active'),
      createWorktree('feature/archived', { archived: true }),
    ])

    render(App, undefined, { api })

    await screen.findByRole('button', { name: /^feature\/active(?![-/])/i })
    expect(screen.queryByRole('button', { name: /feature\/archived/i })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('switch', { name: /show archived worktrees/i }))

    expect(await screen.findByRole('button', { name: /^feature\/archived(?![-/])/i })).toBeInTheDocument()
  })

  it('keeps the current selection while filtering the worktree list', async () => {
    api.fetchWorktrees.mockResolvedValue([
      createWorktree('main'),
      createWorktree('feature/alpha'),
      createWorktree('feature/beta'),
    ])

    render(App, undefined, { api })

    const searchInput = await screen.findByRole('searchbox', { name: /search worktrees/i })
    await screen.findByTitle('main')

    await fireEvent.focus(searchInput)
    await fireEvent.input(searchInput, { target: { value: 'feature' } })

    expect(screen.getByTitle('main')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^main(?![-/])/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^feature\/alpha(?![-/])/i })).toBeInTheDocument()
  })

  it('clears the worktree search from the trailing clear button', async () => {
    api.fetchWorktrees.mockResolvedValue([createWorktree('feature/alpha'), createWorktree('feature/beta')])

    render(App, undefined, { api })

    const searchInput = await screen.findByRole('searchbox', { name: /search worktrees/i })
    await fireEvent.input(searchInput, { target: { value: 'alpha' } })
    expect(searchInput).toHaveValue('alpha')

    await fireEvent.click(screen.getByRole('button', { name: /clear worktree search/i }))

    expect(searchInput).toHaveValue('')
  })

  it('archives the selected worktree through the API', async () => {
    api.fetchWorktrees
      .mockResolvedValueOnce([createWorktree('feature/active')])
      .mockResolvedValueOnce([createWorktree('feature/active', { archived: true })])
      .mockResolvedValue([createWorktree('feature/active', { archived: true })])

    render(App, undefined, { api })

    await screen.findByTitle('feature/active')
    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(api.setWorktreeArchived).toHaveBeenCalledWith('feature/active', true)
    })
  })

  // Removing a worktree deletes its branch, so work that lives only there is
  // gone. The dialog has to say so, and the discard has to be explicit.
  it('names the work a removal would discard, and only then discards it', async () => {
    const dirty = createWorktree('feature/active', { dirty: true })
    api.fetchWorktrees.mockResolvedValue([dirty])

    render(App, undefined, { api })

    await screen.findByTitle('feature/active')
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await screen.findByText(/uncommitted changes that exist nowhere else/)
    await fireEvent.click(screen.getByRole('button', { name: 'Discard and remove' }))

    await waitFor(() => {
      expect(api.removeWorktree).toHaveBeenCalledWith('feature/active', true)
    })
  })

  it('removes a worktree with nothing to lose without asking to discard anything', async () => {
    api.fetchWorktrees.mockResolvedValue([createWorktree('feature/active')])

    render(App, undefined, { api })

    await screen.findByTitle('feature/active')
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const confirms = await screen.findAllByRole('button', { name: 'Remove' })
    await fireEvent.click(confirms[confirms.length - 1] as HTMLElement)

    await waitFor(() => {
      expect(api.removeWorktree).toHaveBeenCalledWith('feature/active', false)
    })
  })

  it('reconnects the visible terminal after refreshing a stale terminal', async () => {
    const staleWorktree = createWorktree('feature/active', {
      mux: '✓',
      agentName: 'codex',
      agentLabel: 'Codex',
      agentTerminalStale: true,
    })
    const refreshedWorktree = createWorktree('feature/active', {
      mux: '✓',
      agentName: 'codex',
      agentLabel: 'Codex',
      agentTerminalStale: false,
    })

    api.fetchWorktrees
      .mockResolvedValueOnce([staleWorktree])
      .mockResolvedValueOnce([refreshedWorktree])
      .mockResolvedValue([refreshedWorktree])

    render(App, undefined, { api })

    await screen.findByText('Terminal stale')
    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(api.refreshWorktreeAgentTerminal).toHaveBeenCalledWith('feature/active')
    })
    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2)
    })
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED)
  })

  it('edits the selected worktree label from the header', async () => {
    api.fetchWorktrees.mockResolvedValue([createWorktree('feature/active')])
    api.setWorktreeLabel.mockResolvedValue('Search ranking')

    render(App, undefined, { api })

    await screen.findByTitle('feature/active')
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace label' }))
    await fireEvent.input(screen.getByLabelText('Label'), {
      target: { value: 'Search ranking' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.setWorktreeLabel).toHaveBeenCalledWith('feature/active', 'Search ranking')
    })
    expect(screen.getAllByText('Search ranking').length).toBeGreaterThan(0)
  })

  it('switches a worktree to another profile from the sidebar row menu', async () => {
    api.fetchConfig.mockResolvedValue(
      createConfig({
        profiles: [{ name: 'slim' }, { name: 'full' }],
        defaultProfileName: 'slim',
      }),
    )
    api.fetchWorktrees.mockResolvedValue([createWorktree('feature/active', { profile: 'slim', mux: '✓' })])

    render(App, undefined, { api })

    await screen.findByTitle('feature/active')
    openMenu(screen.getByRole('button', { name: /actions for feature\/active/i }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Change profile…' }))
    await fireEvent.click(screen.getByRole('radio', { name: 'full' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Switch' }))

    await waitFor(() => {
      expect(api.setWorktreeProfile).toHaveBeenCalledWith('feature/active', 'full')
    })
  })

  it('shows a setup message in the Linear panel when LINEAR_API_KEY is missing', async () => {
    api.fetchWorktrees.mockResolvedValue([])
    api.fetchLinearIssues.mockResolvedValue(createLinearIssuesResponse({ availability: 'missing_api_key' }))

    render(App, undefined, { api })

    const toggle = await screen.findByRole('button', { name: /linear/i })
    expect(toggle).toBeInTheDocument()

    await fireEvent.click(toggle)

    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'Set LINEAR_API_KEY to show your assigned Linear issues here.',
      ),
    ).toBeInTheDocument()
  })

  it('shows an empty-state message in the Linear panel when Linear is ready but has no issues', async () => {
    api.fetchWorktrees.mockResolvedValue([])
    api.fetchLinearIssues.mockResolvedValue(createLinearIssuesResponse({ availability: 'ready', issues: [] }))

    render(App, undefined, { api })

    const toggle = await screen.findByRole('button', { name: /linear/i })
    expect(toggle).toBeInTheDocument()

    await fireEvent.click(toggle)

    expect(await screen.findByText('No assigned Linear issues right now.')).toBeInTheDocument()
  })

  it('shows the web chat UI on desktop when the local setting is enabled', async () => {
    const worktree = createWorktree('feature/chat', {
      mux: '✓',
      interfaceMode: 'web_chat',
      agentName: 'claude',
      agentLabel: 'Claude',
    })
    localStorage.setItem(WEB_CHAT_UI_STORAGE_KEY, 'true')
    api.fetchWorktrees.mockResolvedValue([worktree])
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse(worktree))

    render(App, undefined, { api })

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(api.attachWorktreeConversation).toHaveBeenCalledWith('feature/chat')
  })

  it('reopens the selected session when enabling the Web Chat UI', async () => {
    const worktree = createWorktree('feature/switch-chat', {
      mux: '✓',
      interfaceMode: 'terminal',
      agentName: 'codex',
      agentLabel: 'Codex',
    })
    api.fetchWorktrees.mockResolvedValue([worktree])

    render(App, undefined, { api })

    await screen.findByTitle('feature/switch-chat')
    await fireEvent.click(screen.getByTitle('Settings'))
    await fireEvent.click(screen.getByRole('switch', { name: 'Use web chat UI' }))

    await waitFor(() => {
      expect(api.closeWorktree).toHaveBeenCalledWith('feature/switch-chat')
      expect(api.openWorktree).toHaveBeenCalledWith('feature/switch-chat', 'web_chat')
    })
  })

  it('does not show the stale terminal banner in the web chat UI', async () => {
    const worktree = createWorktree('feature/chat-stale-terminal', {
      mux: '✓',
      interfaceMode: 'web_chat',
      agentName: 'codex',
      agentLabel: 'Codex',
      agentTerminalStale: true,
    })
    localStorage.setItem(WEB_CHAT_UI_STORAGE_KEY, 'true')
    api.fetchWorktrees.mockResolvedValue([worktree])
    api.attachWorktreeConversation.mockResolvedValue(createConversationResponse(worktree))

    render(App, undefined, { api })

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.queryByText('Terminal stale')).not.toBeInTheDocument()
  })

  it('hides the Linear ticket option when disabled in config', async () => {
    api.fetchWorktrees.mockResolvedValue([])

    render(App, undefined, { api })

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })

    expect(screen.queryByRole('switch', { name: /create linear ticket/i })).not.toBeInTheDocument()
  })

  it('submits Linear ticket creation when the option is enabled', async () => {
    api.fetchConfig.mockResolvedValue(
      createConfig({
        linearCreateTicketOption: true,
      }),
    )
    api.fetchWorktrees.mockResolvedValue([])
    api.createWorktree.mockResolvedValue({
      primaryBranch: 'eng-123-new-flow',
      branches: ['eng-123-new-flow'],
    })

    render(App, undefined, { api })

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })

    const linearToggle = screen.getByRole('switch', { name: /create linear ticket/i })
    await fireEvent.click(linearToggle)

    const createButton = screen.getByRole('button', { name: 'Create' })
    expect(createButton).toBeDisabled()
    expect(screen.getByLabelText(/Branch name/i)).toBeDisabled()

    await fireEvent.input(screen.getByLabelText(/Prompt/i), {
      target: { value: 'Implement the new flow' },
    })
    await fireEvent.input(screen.getByLabelText(/Team key/i), {
      target: { value: 'ENG' },
    })
    await fireEvent.input(screen.getByLabelText(/Linear ticket title/i), {
      target: { value: 'Ship Linear-backed worktree creation' },
    })
    await waitFor(() => {
      expect(createButton).not.toBeDisabled()
    })
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(api.createWorktree).toHaveBeenCalledWith({
        mode: 'new',
        profile: 'default',
        agents: ['claude'],
        prompt: 'Implement the new flow',
        createLinearTicket: true,
        linearTeamKey: 'ENG',
        linearTitle: 'Ship Linear-backed worktree creation',
        interfaceMode: 'terminal',
      })
    })
  })

  it('shows prefixed branch previews when multiple agents are selected', async () => {
    api.fetchWorktrees.mockResolvedValue([])

    render(App, undefined, { api })

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })

    await fireEvent.click(screen.getByRole('switch', { name: /enable multiple agent selection/i }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }))
    await fireEvent.input(screen.getByLabelText(/Branch name/i), {
      target: { value: 'feature/new' },
    })

    expect(screen.getByText('claude-feature/new')).toBeInTheDocument()
    expect(screen.getByText('codex-feature/new')).toBeInTheDocument()
  })

  it('submits multi-agent worktree creation when multiple agents are selected', async () => {
    api.fetchWorktrees.mockResolvedValue([])
    api.createWorktree.mockResolvedValue({
      primaryBranch: 'claude-feature/new',
      branches: ['claude-feature/new', 'codex-feature/new'],
    })

    render(App, undefined, { api })

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })

    await fireEvent.click(screen.getByRole('switch', { name: /enable multiple agent selection/i }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Codex' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Use existing branch' })).not.toBeInTheDocument()
    })

    await fireEvent.input(screen.getByLabelText(/Branch name/i), {
      target: { value: 'feature/new' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(api.createWorktree).toHaveBeenCalledWith({
        mode: 'new',
        branch: 'feature/new',
        profile: 'default',
        agents: ['claude', 'codex'],
        interfaceMode: 'terminal',
      })
    })
  })

  it('submits an explicit base branch when provided', async () => {
    api.fetchWorktrees.mockResolvedValue([])
    api.fetchBaseBranches.mockResolvedValue([{ name: 'release/base' }])
    api.createWorktree.mockResolvedValue({
      primaryBranch: 'feature/from-release',
      branches: ['feature/from-release'],
    })

    render(App, undefined, { api })

    await openCreateDialogWithBaseAndSubmit('feature/from-release', 'release/base')

    await waitFor(() => {
      expect(api.createWorktree).toHaveBeenCalledWith({
        mode: 'new',
        branch: 'feature/from-release',
        baseBranch: 'release/base',
        profile: 'default',
        agents: ['claude'],
        interfaceMode: 'terminal',
      })
    })
  })

  it('caches branch lists across dialog openings and only fetches each mode once', async () => {
    api.fetchWorktrees.mockResolvedValue([])
    api.fetchAvailableBranches
      .mockResolvedValueOnce([{ name: 'feature/local-only' }])
      .mockResolvedValueOnce([{ name: 'feature/local-only' }, { name: 'feature/remote-only' }])
    api.fetchBaseBranches.mockResolvedValue([{ name: 'main' }])

    render(App, undefined, { api })

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })

    await waitFor(() => {
      expect(api.fetchAvailableBranches).toHaveBeenCalledTimes(1)
      expect(api.fetchAvailableBranches).toHaveBeenCalledWith(false)
      expect(api.fetchBaseBranches).toHaveBeenCalledTimes(1)
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Use existing branch' }))
    await fireEvent.click(await screen.findByRole('switch', { name: /include remote branches/i }))

    await waitFor(() => {
      expect(api.fetchAvailableBranches).toHaveBeenCalledTimes(2)
      expect(api.fetchAvailableBranches).toHaveBeenLastCalledWith(true)
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })

    await waitFor(() => {
      expect(api.fetchAvailableBranches).toHaveBeenCalledTimes(2)
      expect(api.fetchBaseBranches).toHaveBeenCalledTimes(1)
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Use existing branch' }))
    await fireEvent.click(await screen.findByRole('switch', { name: /include remote branches/i }))

    await waitFor(() => {
      expect(api.fetchAvailableBranches).toHaveBeenCalledTimes(2)
      expect(api.fetchBaseBranches).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps the current branch list visible while remote branches are loading', async () => {
    const remoteBranches = deferred<Array<{ name: string }>>()

    api.fetchWorktrees.mockResolvedValue([])
    api.fetchAvailableBranches
      .mockResolvedValueOnce([{ name: 'feature/local-only' }])
      .mockReturnValueOnce(remoteBranches.promise)

    render(App, undefined, { api })

    await fireEvent.click(screen.getByTitle('New run (Cmd+Shift+K)'))
    await screen.findByRole('heading', { name: 'New run' })
    await fireEvent.click(screen.getByRole('button', { name: 'Use existing branch' }))

    expect(await screen.findByRole('button', { name: 'feature/local-only' })).toBeInTheDocument()

    await fireEvent.click(await screen.findByRole('switch', { name: /include remote branches/i }))

    expect(screen.getByRole('button', { name: 'feature/local-only' })).toBeInTheDocument()
    expect(screen.getByText('Updating...')).toBeInTheDocument()

    remoteBranches.resolve([{ name: 'feature/local-only' }, { name: 'feature/remote-only' }])

    expect(await screen.findByRole('button', { name: 'feature/remote-only' })).toBeInTheDocument()
  })

  it('posts directly to the linked Linear issue via the row menu confirm dialog', async () => {
    const linkedWorktree = createWorktree('feature/linked', {
      mux: '✓',
      linearIssue: {
        identifier: 'ENG-42',
        url: 'https://linear.app/example/issue/ENG-42',
        state: { name: 'In Progress', color: '#5e6ad2', type: 'started' },
      },
    })
    api.fetchWorktrees.mockResolvedValue([linkedWorktree])

    render(App, undefined, { api })

    await screen.findByTitle('feature/linked')

    openMenu(screen.getByRole('button', { name: /actions for feature\/linked/i }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Post conversation to ENG-42' }))

    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(api.postWorktreeToLinear).toHaveBeenCalledTimes(1)
    })
    expect(api.postWorktreeToLinear).toHaveBeenCalledWith('feature/linked', {
      kind: 'issue',
      issueId: 'ENG-42',
    })
    expect(screen.queryByText('Post to Linear')).not.toBeInTheDocument()
  })

  it('disables the linked-issue menu item while a post is in flight', async () => {
    const linkedWorktree = createWorktree('feature/linked', {
      mux: '✓',
      linearIssue: {
        identifier: 'ENG-42',
        url: 'https://linear.app/example/issue/ENG-42',
        state: { name: 'In Progress', color: '#5e6ad2', type: 'started' },
      },
    })
    api.fetchWorktrees.mockResolvedValue([linkedWorktree])
    const pending = deferred<{
      ok: true
      issueId: string
      issueUrl: string
      commentUrl: string | null
      attachmentUrl: string
    }>()
    api.postWorktreeToLinear.mockReturnValueOnce(pending.promise)

    render(App, undefined, { api })

    await screen.findByTitle('feature/linked')

    openMenu(screen.getByRole('button', { name: /actions for feature\/linked/i }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Post conversation to ENG-42' }))
    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(api.postWorktreeToLinear).toHaveBeenCalledTimes(1)
    })

    openMenu(screen.getByRole('button', { name: /actions for feature\/linked/i }))
    const pendingMenuItem = await screen.findByRole('menuitem', { name: 'Posting to Linear…' })
    expect(pendingMenuItem).toHaveAttribute('aria-disabled', 'true')
    await fireEvent.click(pendingMenuItem)
    expect(api.postWorktreeToLinear).toHaveBeenCalledTimes(1)

    pending.resolve({
      ok: true,
      issueId: 'ENG-42',
      issueUrl: 'https://linear.app/example/issue/ENG-42',
      commentUrl: null,
      attachmentUrl: 'https://linear.app/attachment/x',
    })
  })
})

function createRunDetail(): RunDetailResponse {
  return {
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
      executions: [],
      result: null,
      workflowProgress: null,
      artifacts: [],
    },
  }
}

function createRunEvent(sequence: number): RunEvent {
  return {
    id: `event_${sequence}`,
    runId: 'run_01',
    executionId: null,
    sessionId: null,
    sequence,
    type: 'workflow.phase.started',
    timestamp: '2026-09-09T12:00:01.000Z',
    source: 'workflow',
    payload: { version: 1, data: {} },
  }
}

describe('App routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    cleanup()
    localStorage.clear()
    api = fakeProjectApi({
      fetchAgents: async () => [],
      fetchRuns: async () => ({ runs: [] }),
      fetchRunEvents: async () => ({ events: [], nextCursor: null }),
      connectRunEventStream: () => () => {},
      connectExecutionTranscriptStream: () => () => {},
      fetchWorkflows: async () => ({ workflows: [] }),
      fetchRunWorkspaceContext: async () => ({
        path: '/repo',
        branch: 'main',
        headCommit: 'abc123',
        dirty: false,
        activeReaders: 0,
        activeWriterRunId: null,
      }),
    })
    router.go('/projects/shop/worktrees')
    setupBrowserMocks()
    api.fetchConfig.mockResolvedValue(createConfig())
    api.fetchWorktrees.mockResolvedValue([])
    api.fetchLinearIssues.mockResolvedValue(createLinearIssuesResponse())
    api.subscribeNotifications.mockReturnValue(() => {})
  })

  afterEach(async () => {
    cleanup()
    restoreBrowserMocks()
  })

  it('opens the worktree named in the URL', async () => {
    router.go('/projects/shop/worktrees/feature%2Fbeta')
    api.fetchWorktrees.mockResolvedValue([
      createWorktree('feature/alpha', { mux: '✓' }),
      createWorktree('feature/beta'),
    ])

    render(App, undefined, { api })

    expect(await screen.findByTitle('feature/beta')).toBeInTheDocument()
    expect(router.get()).toBe('/projects/shop/worktrees/feature%2Fbeta')
  })

  it('replaces the root with the worktree it opens', async () => {
    api.fetchWorktrees.mockResolvedValue([createWorktree('main', { mux: '✓' })])

    render(App, undefined, { api })

    await screen.findByTitle('main')
    await waitFor(() => {
      expect(router.get()).toBe('/projects/shop/worktrees/main')
    })
  })

  it('opens a Run from the Runs section and follows its event stream', async () => {
    const detail = createRunDetail()
    const listed: RunListResponse['runs'][number] = { ...detail.run }
    api.fetchRuns.mockResolvedValue({ runs: [listed] })
    api.fetchRun.mockResolvedValue(detail)

    // The Runs tab is the Project's, around this frame; arriving on its path is what it does.
    router.go('/projects/shop/runs')
    render(App, undefined, { api })

    await fireEvent.click(await screen.findByRole('button', { name: /taskflow\/run/ }))

    expect(router.get()).toBe('/projects/shop/runs/run_01')
    expect(await screen.findByRole('heading', { name: 'taskflow/run' })).toBeInTheDocument()
    await waitFor(() => {
      expect(api.connectRunEventStream).toHaveBeenCalledWith('run_01', null, expect.anything())
    })

    const callbacks = api.connectRunEventStream.mock.calls.at(-1)?.[2]
    const runFetches = api.fetchRun.mock.calls.length
    act(() => callbacks?.onEvent(createRunEvent(1)))

    expect(await screen.findByText('phase · started')).toBeInTheDocument()
    await waitFor(() => {
      expect(api.fetchRun.mock.calls.length).toBeGreaterThan(runFetches)
    })
  })

  it('opens the first workflow of the catalog', async () => {
    api.fetchWorkflows.mockResolvedValue({
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
          workspace: { default: 'isolated_worktree', allowed: ['isolated_worktree'], mutatesRepository: true },
        },
      ],
    })

    router.go('/projects/shop/workflows')
    render(App, undefined, { api })

    expect(await screen.findByRole('heading', { name: 'Release Check' })).toBeInTheDocument()
    expect(router.get()).toBe('/projects/shop/workflows/project%3Arelease')
  })
})
