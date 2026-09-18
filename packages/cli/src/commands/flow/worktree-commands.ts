import { basename, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import type {
  EnvironmentExecRequest,
  EnvironmentExecResponse,
  EnvironmentExposeRequest,
  EnvironmentResponse,
  EnvironmentServicesResponse,
  EnvironmentTerminalResponse,
  OkResponse,
} from 'portta-contracts/taskflow'
import type {
  AgentId,
  MultiplexerKind,
  OpenSessionsState,
  PrEntry,
  SessionInterfaceMode,
  WorktreeCreationPhase,
} from 'portta-core/taskflow'
import { compareWorktreeOrder, isValidWorktreeName } from 'portta-core/taskflow'
import { ENV_NAMES } from 'portta-core/taskflow/config'
import { createTaskflowRuntime } from 'portta-host/taskflow'
import { persistLocalMultiplexer } from 'portta-host/taskflow/adapters/config'
import {
  readOpenSessionsState,
  readWorktreeArchiveState,
  readWorktreeMeta,
  readWorktreePrs,
} from 'portta-host/taskflow/adapters/fs'
import { buildProjectSessionName, buildWorktreeWindowName } from 'portta-host/taskflow/adapters/session-gateway'
import { buildArchivedWorktreePathSet } from 'portta-host/taskflow/services/archive-service'
import {
  buildSeedFromLinear,
  defaultSeedFromLinearDeps,
} from 'portta-host/taskflow/services/conversation-export-service'
import type {
  CreateLifecycleWorktreeInput,
  CreateLifecycleWorktreesInput,
  CreateLifecycleWorktreesResult,
  CreateWorktreeProgress,
  PruneWorktreesResult,
} from 'portta-host/taskflow/services/lifecycle-service'
import { switchMultiplexer } from 'portta-host/taskflow/services/multiplexer-switch-service'
import { computeOpenBranches } from 'portta-host/taskflow/services/session-restore-service'
import { runProcess } from '../../process.ts'
import { flowApi } from './daemon.ts'
import { ENVIRONMENT_ACTIONS, type FlowAction, flowInvocation } from './flow-action.ts'
import {
  CommandUsageError,
  parseEnvOverrides,
  resolveProjectBaseUrl,
  resolveProjectPrefix,
  withServerConnection,
} from './shared.ts'

const PHASE_LABELS: Record<WorktreeCreationPhase, string> = {
  creating_worktree: 'Creating worktree',
  running_post_create_hook: 'Running post-create hook',
  preparing_runtime: 'Preparing runtime',
  starting_session: 'Starting session',
  reconciling: 'Reconciling',
}

type WorktreeListMode = 'active' | 'all' | 'archived'

interface LifecycleServiceLike {
  createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }>
  createWorktrees(input: CreateLifecycleWorktreesInput): Promise<CreateLifecycleWorktreesResult>
  openWorktree(
    branch: string,
    options?: { interfaceMode?: SessionInterfaceMode },
  ): Promise<{ branch: string; worktreeId: string }>
  closeWorktree(branch: string): Promise<void>
  refreshAgentTerminal(branch: string): Promise<{ branch: string; worktreeId: string }>
  setWorktreeArchived(branch: string, archived: boolean): Promise<void>
  setWorktreeLabel(branch: string, label: string | null): Promise<{ label: string | null }>
  setWorktreeProfile(branch: string, profile: string): Promise<{ profile: string; restarted: boolean }>
  removeWorktree(branch: string): Promise<void>
  mergeWorktree(branch: string): Promise<void>
  pruneWorktrees(): Promise<PruneWorktreesResult>
}

interface WorktreeRuntimeLike {
  projectDir: string
  config: {
    multiplexer: MultiplexerKind
    workspace: {
      mainBranch: string
    }
  }
  git: {
    listWorktrees(cwd: string): Array<{ path: string; branch: string | null; bare: boolean }>
    resolveWorktreeGitDir(cwd: string): string
  }
  sessions: {
    listWindows(): Promise<Array<{ sessionName: string; windowName: string }>>
    focusWindow(sessionName: string, windowName: string): Promise<void>
  }
  lifecycleService: LifecycleServiceLike
}

interface WorktreeCommandContext {
  request: WorktreeRequest
  projectDir: string
  port: number
}

interface WorktreeCommandDependencies {
  createRuntime?: (options: {
    projectDir: string
    port: number
    prefix?: string
    onCreateProgress?: (progress: CreateWorktreeProgress) => void
  }) => WorktreeRuntimeLike
  stdout?: (message: string) => void
  stderr?: (message: string) => void
  switchToSessionWindow?: (projectDir: string, branch: string, multiplexer: MultiplexerKind) => void | Promise<void>
  confirmPrune?: (worktreeCount: number) => Promise<boolean>
  /** Resolve the project-scoped base URL for server-backed commands (send/tab).
   *  Injectable so tests can exercise the HTTP shape without a live server. */
  resolveBaseUrl?: (port: number, projectDir: string) => Promise<string>
  /** Resolve the project's route prefix so control.env written by in-process
   *  commands (add/open/refresh) matches the dashboard's prefixed routes.
   *  Returns undefined when it can't be resolved (no server), so no control URL
   *  is written. Injectable so tests can drive it without a live server. */
  resolveProjectPrefix?: (port: number, projectDir: string) => Promise<string | undefined>
  /** Read the saved open-sessions snapshot (used by `restore`). Injectable so
   *  tests can drive restore without touching the filesystem. */
  readOpenSessions?: (gitDir: string) => Promise<OpenSessionsState>
}

function parseAgent(value: string): AgentId {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new CommandUsageError('Agent id cannot be empty')
  }
  return trimmed
}

function parseInterfaceMode(value: string): SessionInterfaceMode {
  if (value === 'terminal') return 'terminal'
  if (value === 'web-chat' || value === 'web_chat') return 'web_chat'
  throw new CommandUsageError('--interface must be "terminal" or "web-chat"')
}

function requireWorktreeName(branch: string | undefined): string {
  if (!branch) throw new CommandUsageError('Missing required argument: <branch>')
  if (!isValidWorktreeName(branch)) throw new CommandUsageError('Invalid worktree name')
  return branch
}

export interface ParsedAddCommand {
  input: CreateLifecycleWorktreesInput
  detach: boolean
  fromLinearIssueId: string | null
  branchExplicit: boolean
}

export interface AddCliOptions {
  existing?: boolean
  base?: string
  profile?: string
  agent?: string[]
  prompt?: string
  env?: string[]
  interface?: string
  detach?: boolean
  fromLinear?: string
  branch?: string
}

export function buildAddCommand(branchArg: string | undefined, options: AddCliOptions): ParsedAddCommand {
  const input: CreateLifecycleWorktreesInput = {}
  let fromLinearIssueId: string | null = null

  if (options.existing) input.mode = 'existing'
  if (options.profile !== undefined) input.profile = options.profile
  if (options.base !== undefined) input.baseBranch = options.base
  if (options.prompt !== undefined) input.prompt = options.prompt
  if (options.interface !== undefined) input.interfaceMode = parseInterfaceMode(options.interface)

  if (options.fromLinear !== undefined) {
    const trimmed = options.fromLinear.trim()
    if (!/^[A-Z]+-\d+$/.test(trimmed)) {
      throw new CommandUsageError(`--from-linear expects an issue id like ENG-123 (got "${trimmed}")`)
    }
    fromLinearIssueId = trimmed
  }

  if (options.branch !== undefined && branchArg !== undefined && options.branch !== branchArg) {
    throw new CommandUsageError(`Conflicting branch values: "${branchArg}" and "${options.branch}"`)
  }
  const branch = options.branch?.trim() ?? branchArg
  if (branch !== undefined) input.branch = branch

  const agents = (options.agent ?? []).map(parseAgent)
  if (agents.length > 0) input.agents = agents

  const envOverrides = parseEnvOverrides(options.env)
  if (envOverrides) input.envOverrides = envOverrides

  return { input, detach: Boolean(options.detach), fromLinearIssueId, branchExplicit: branch !== undefined }
}

export type TabAction = 'list' | 'new' | 'switch' | 'close'

export interface ParsedTabCommand {
  branch: string
  action: TabAction
  tabId?: string
}

export function buildTabCommand(branchArg: string, action: TabAction, tabId: string | undefined): ParsedTabCommand {
  const branch = requireWorktreeName(branchArg)
  if ((action === 'switch' || action === 'close') && !tabId) {
    throw new CommandUsageError(`The "${action}" action requires a <tabId>`)
  }
  if ((action === 'list' || action === 'new') && tabId) throw new CommandUsageError(`Unexpected argument: ${tabId}`)
  return { branch, action, ...(tabId ? { tabId } : {}) }
}

export interface ParsedSendCommand {
  branch: string
  text: string
  preamble?: string
}

export interface ParsedLabelCommand {
  branch: string
  label: string | null
}

export interface ParsedProfileCommand {
  branch: string
  profile: string
}

export interface ParsedListCommand {
  mode: WorktreeListMode
  search: string
}

export function buildLabelCommand(
  branchArg: string,
  labelParts: string[],
  options: { clear?: boolean; label?: string },
): ParsedLabelCommand {
  const branch = requireWorktreeName(branchArg)
  if (options.label !== undefined && labelParts.length > 0) {
    throw new CommandUsageError('Cannot use --label with a positional label')
  }

  const label = (options.label ?? labelParts.join(' ')).trim()
  if (options.clear && label) {
    throw new CommandUsageError('Cannot use --clear with a label')
  }

  if (!options.clear && !label) {
    throw new CommandUsageError('Missing required argument: <label>')
  }

  return { branch, label: options.clear ? null : label }
}

export function buildProfileCommand(
  branchArg: string,
  profileArg: string | undefined,
  options: { profile?: string },
): ParsedProfileCommand {
  const branch = requireWorktreeName(branchArg)
  if (options.profile !== undefined && profileArg !== undefined) {
    throw new CommandUsageError('Cannot use --profile with a positional profile')
  }

  const profile = (options.profile ?? profileArg ?? '').trim()
  if (!profile) {
    throw new CommandUsageError('Missing required argument: <profile>')
  }

  return { branch, profile }
}

export function buildSendCommand(
  branchArg: string,
  promptArg: string | undefined,
  options: { prompt?: string; preamble?: string },
): ParsedSendCommand {
  const branch = requireWorktreeName(branchArg)
  if (options.prompt !== undefined && promptArg !== undefined) {
    throw new CommandUsageError('Cannot use --prompt with a positional prompt argument')
  }

  const text = options.prompt ?? promptArg
  if (!text) {
    throw new CommandUsageError('Missing required argument: <prompt>')
  }

  return { branch, text, ...(options.preamble !== undefined ? { preamble: options.preamble } : {}) }
}

export function buildListCommand(options: { all?: boolean; archived?: boolean; search?: string }): ParsedListCommand {
  if (options.all && options.archived) {
    throw new CommandUsageError('Cannot use --all with --archived')
  }
  return { mode: options.all ? 'all' : options.archived ? 'archived' : 'active', search: options.search ?? '' }
}

export type WorktreeRequest =
  | { command: 'add'; add: ParsedAddCommand }
  | { command: 'list'; list: ParsedListCommand }
  | { command: 'open'; branch: string; interfaceMode?: SessionInterfaceMode }
  | { command: 'close' | 'refresh' | 'archive' | 'unarchive' | 'merge'; branch: string }
  | { command: 'remove'; branch: string; force: boolean }
  | { command: 'label'; label: ParsedLabelCommand }
  | { command: 'profile'; profile: ParsedProfileCommand }
  | { command: 'send'; send: ParsedSendCommand }
  | { command: 'tab'; tab: ParsedTabCommand }
  | { command: 'prune' }
  | { command: 'restore' }
  | { command: 'multiplexer'; target: MultiplexerKind | null }

/** Validate a parsed worktree command into the request its handler runs. */
export function worktreeRequestFromCli(action: FlowAction): WorktreeRequest {
  const [command] = action.path
  const [first, second, third] = action.args as [unknown, unknown, unknown]
  const options = action.options
  switch (command) {
    case 'add':
      return { command, add: buildAddCommand(first as string | undefined, options) }
    case 'list':
      return { command, list: buildListCommand(options) }
    case 'open':
      return {
        command,
        branch: requireWorktreeName(first as string),
        ...(options.interface !== undefined ? { interfaceMode: parseInterfaceMode(options.interface) } : {}),
      }
    case 'remove':
      return { command, branch: requireWorktreeName(first as string), force: options.force === true }
    case 'close':
    case 'refresh':
    case 'archive':
    case 'unarchive':
    case 'merge':
      return { command, branch: requireWorktreeName(first as string) }
    case 'label':
      return { command, label: buildLabelCommand(first as string, second as string[], options) }
    case 'profile':
      return { command, profile: buildProfileCommand(first as string, second as string | undefined, options) }
    case 'send':
      return { command, send: buildSendCommand(first as string, second as string | undefined, options) }
    case 'tab':
      return { command, tab: buildTabCommand(first as string, second as TabAction, third as string | undefined) }
    case 'prune':
      return { command }
    case 'restore':
      return { command }
    case 'multiplexer':
      return { command, target: (first as MultiplexerKind | undefined) ?? null }
    default:
      throw new CommandUsageError(`Unknown worktree command: ${action.path.join(' ')}`)
  }
}

function listProjectWorktrees(
  runtime: WorktreeRuntimeLike,
): Array<{ path: string; branch: string | null; bare: boolean }> {
  const projectDir = resolve(runtime.projectDir)
  return runtime.git.listWorktrees(projectDir).filter((entry) => !entry.bare && resolve(entry.path) !== projectDir)
}

async function buildOpenWorktreeWindowSet(runtime: WorktreeRuntimeLike): Promise<Set<string>> {
  const sessionName = buildProjectSessionName(resolve(runtime.projectDir))
  let windows: Array<{ sessionName: string; windowName: string }> = []
  try {
    windows = await runtime.sessions.listWindows()
  } catch {
    windows = []
  }
  return new Set(windows.filter((w) => w.sessionName === sessionName).map((w) => w.windowName))
}

async function defaultConfirmPrune(worktreeCount: number): Promise<boolean> {
  const response = await p.confirm({
    message: `Prune ${worktreeCount} closed worktree${worktreeCount === 1 ? '' : 's'}? This action cannot be undone.`,
    initialValue: false,
  })
  return !p.isCancel(response) && response === true
}

/** Bring the user's own terminal to a worktree's window.
 *
 *  herdr has no `switch-client`: focusing is a socket call (done by the caller
 *  through the gateway), and attaching means running herdr's own client, which
 *  always opens on the focused tab. Inside an existing herdr client, focusing is
 *  the whole operation — spawning a second client would nest them. */
async function attachToHerdr(): Promise<void> {
  // herdr exports these into every pane it owns, so their presence means we are
  // already running inside a client and focusing was the whole job. Checking
  // HERDR_SESSION instead would be wrong: that selects a named session and is
  // commonly set *outside* herdr, which would suppress attaching entirely.
  if (process.env.HERDR_PANE_ID || process.env.HERDR_ENV) return

  const result = await runProcess('herdr', [], { stdio: 'inherit', reject: false })
  if (result.exitCode !== 0) {
    console.error('Warning: failed to attach to herdr')
  }
}

/** Focus a worktree's window through the gateway, tolerating a closed one, then
 *  attach. Focusing is a gateway concern (tmux select-window vs herdr's socket);
 *  attaching stays here because it takes over the caller's terminal. */
async function focusAndSwitch(
  runtime: WorktreeRuntimeLike,
  branch: string,
  switchToSessionWindow: (projectDir: string, branch: string, multiplexer: MultiplexerKind) => void | Promise<void>,
): Promise<void> {
  try {
    await runtime.sessions.focusWindow(
      buildProjectSessionName(resolve(runtime.projectDir)),
      buildWorktreeWindowName(branch),
    )
  } catch {
    return // window is gone — nothing to attach to
  }
  await switchToSessionWindow(runtime.projectDir, branch, runtime.config.multiplexer)
}

async function defaultSwitchToSessionWindow(
  projectDir: string,
  _branch: string,
  multiplexer: MultiplexerKind,
): Promise<void> {
  if (multiplexer === 'herdr') {
    await attachToHerdr()
    return
  }

  const sessionName = buildProjectSessionName(resolve(projectDir))

  if (process.env.TMUX) {
    const result = await runProcess('tmux', ['switch-client', '-t', sessionName], { reject: false })
    if (result.exitCode !== 0) {
      console.error(`Warning: failed to switch tmux client to ${sessionName}`)
    }
  } else {
    const result = await runProcess('tmux', ['attach-session', '-t', sessionName], { stdio: 'inherit', reject: false })
    if (result.exitCode !== 0) {
      console.error(`Warning: failed to attach to tmux session ${sessionName}`)
    }
  }
}

interface ListedWorktreeRow {
  branch: string
  label: string | null
  isOpen: boolean
  archived: boolean
  prStates: PrEntry['state'][]
  info: string
  searchText: string
}

function matchesListSearch(row: ListedWorktreeRow, query: string): boolean {
  return query.length === 0 || row.searchText.toLowerCase().includes(query.toLowerCase())
}

async function listWorktrees(
  runtime: WorktreeRuntimeLike,
  stdout: (message: string) => void,
  options: ParsedListCommand,
): Promise<void> {
  const projectDir = resolve(runtime.projectDir)
  const entries = listProjectWorktrees(runtime)

  if (entries.length === 0) {
    stdout('No worktrees found.')
    return
  }

  const openWindows = await buildOpenWorktreeWindowSet(runtime)

  const projectGitDir = runtime.git.resolveWorktreeGitDir(projectDir)
  const archivedPaths = buildArchivedWorktreePathSet(await readWorktreeArchiveState(projectGitDir))
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const branch = entry.branch ?? basename(entry.path)
      const isOpen = openWindows.has(buildWorktreeWindowName(branch))
      const gitDir = runtime.git.resolveWorktreeGitDir(entry.path)
      const meta = await readWorktreeMeta(gitDir)
      const prs = await readWorktreePrs(gitDir)
      const info = meta ? `${meta.profile} / ${meta.agent}` : ''
      return {
        branch,
        label: meta?.label ?? null,
        isOpen,
        archived: archivedPaths.has(resolve(entry.path)),
        prStates: prs.map((pr) => pr.state),
        info,
        searchText: [meta?.label ?? '', branch, meta?.baseBranch ?? '', meta?.profile ?? '', meta?.agent ?? ''].join(
          ' ',
        ),
      } satisfies ListedWorktreeRow
    }),
  )

  const matchingRows = rows
    .filter((row) => matchesListSearch(row, options.search.trim()))
    .sort((a, b) =>
      compareWorktreeOrder(
        { branch: a.branch, open: a.isOpen, prStates: a.prStates },
        { branch: b.branch, open: b.isOpen, prStates: b.prStates },
      ),
    )
  const visibleRows = matchingRows.filter((row) => {
    if (options.mode === 'all') return true
    if (options.mode === 'archived') return row.archived
    return !row.archived
  })

  if (visibleRows.length === 0) {
    const hiddenArchivedCount = options.mode === 'active' ? matchingRows.filter((row) => row.archived).length : 0
    if (hiddenArchivedCount > 0) {
      stdout(
        `No active worktrees found. ${hiddenArchivedCount} archived worktree${hiddenArchivedCount === 1 ? '' : 's'} hidden. Use --all or --archived.`,
      )
      return
    }

    if (options.mode === 'archived') {
      stdout('No archived worktrees found.')
      return
    }

    stdout(options.search.trim() ? `No worktrees found for "${options.search.trim()}".` : 'No worktrees found.')
    return
  }

  const maxName = Math.max(
    ...visibleRows.map((row) => (row.label ? `${row.label} (${row.branch})` : row.branch).length),
  )
  for (const row of visibleRows) {
    const status = `${row.isOpen ? 'open' : 'closed'}${row.archived ? ' archived' : ''}`
    const name = row.label ? `${row.label} (${row.branch})` : row.branch
    stdout(`${name.padEnd(maxName + 2)} ${status.padEnd(15)} ${row.info}`.trimEnd())
  }

  if (options.mode === 'active') {
    const hiddenArchivedCount = matchingRows.filter((row) => row.archived).length
    if (hiddenArchivedCount > 0) {
      stdout(
        `Hidden ${hiddenArchivedCount} archived worktree${hiddenArchivedCount === 1 ? '' : 's'}. Use --all or --archived.`,
      )
    }
  }
}

export async function runWorktreeCommand(
  context: WorktreeCommandContext,
  deps: WorktreeCommandDependencies = {},
): Promise<number> {
  const createRuntime = deps.createRuntime ?? ((options) => createTaskflowRuntime(options))
  const stdout = deps.stdout ?? ((message: string) => console.log(message))
  const stderr = deps.stderr ?? ((message: string) => console.error(message))
  const resolveBaseUrl = deps.resolveBaseUrl ?? resolveProjectBaseUrl
  const switchToSessionWindow = deps.switchToSessionWindow ?? defaultSwitchToSessionWindow
  const confirmPrune = deps.confirmPrune ?? defaultConfirmPrune
  const readOpenSessions = deps.readOpenSessions ?? readOpenSessionsState

  // The project's route prefix, resolved from the running server at most once.
  // Only commands that write control.env (add/open/refresh) need it.
  //
  // `createRuntime === undefined` is the production sentinel: real callers never
  // inject deps, so production always resolves. A test that injects createRuntime
  // without a prefix resolver skips the lookup, keeping offline commands offline.
  const shouldResolvePrefix = deps.resolveProjectPrefix !== undefined || deps.createRuntime === undefined
  let prefixPromise: Promise<string | undefined> | null = null
  const resolvePrefix = (): Promise<string | undefined> => {
    if (!shouldResolvePrefix) return Promise.resolve(undefined)
    if (!prefixPromise) {
      prefixPromise = (deps.resolveProjectPrefix ?? resolveProjectPrefix)(context.port, context.projectDir)
    }
    return prefixPromise
  }

  const { request } = context
  try {
    if (request.command === 'add') {
      const parsed = request.add

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
        prefix: await resolvePrefix(),
        onCreateProgress: (progress) => {
          stdout(PHASE_LABELS[progress.phase] ?? progress.phase)
        },
      })

      if (parsed.fromLinearIssueId) {
        stdout(`Resolving Linear issue ${parsed.fromLinearIssueId}...`)
        const seed = await buildSeedFromLinear({ issueId: parsed.fromLinearIssueId }, defaultSeedFromLinearDeps)
        if (!seed.ok) {
          stderr(`Linear seed lookup failed: ${seed.error}`)
          return 1
        }
        stdout(
          `Linear seed source: ${seed.data.source}${seed.data.branch ? ` branch=${seed.data.branch}` : ''}${seed.data.prUrl ? ` pr=${seed.data.prUrl}` : ''}`,
        )

        if (!parsed.branchExplicit && seed.data.branch) {
          parsed.input.branch = seed.data.branch
        }
        if (!parsed.input.branch) {
          stderr('Linear issue did not resolve to a branch; pass --branch to override.')
          return 1
        }
        if (seed.data.source !== 'none') parsed.input.mode = 'existing'
        if (seed.data.conversationMarkdown) {
          parsed.input.prompt = parsed.input.prompt
            ? `${seed.data.conversationMarkdown}\n\n---\n\n${parsed.input.prompt}`
            : seed.data.conversationMarkdown
        }
      }

      if (!parsed.input.branch && parsed.input.prompt && 'autoName' in runtime.config && runtime.config.autoName) {
        stdout('Generating branch name...')
      }

      const result = await runtime.lifecycleService.createWorktrees(parsed.input)
      for (const branch of result.branches) {
        stdout(`Created worktree ${branch}`)
      }
      if (!parsed.detach) {
        await focusAndSwitch(runtime, result.primaryBranch, switchToSessionWindow)
      }
      return 0
    }

    if (request.command === 'list') {
      const parsed = request.list

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      })
      await listWorktrees(runtime, stdout, parsed)
      return 0
    }

    if (request.command === 'prune') {
      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      })
      const worktrees = listProjectWorktrees(runtime)
      if (worktrees.length === 0) {
        stdout('No worktrees found.')
        return 0
      }

      const openWindows = await buildOpenWorktreeWindowSet(runtime)
      const closedWorktrees = worktrees.filter(
        (entry) => !openWindows.has(buildWorktreeWindowName(entry.branch ?? basename(entry.path))),
      )
      if (closedWorktrees.length === 0) {
        stdout('No closed worktrees to prune.')
        return 0
      }

      if (!(await confirmPrune(closedWorktrees.length))) {
        stdout('Aborted.')
        return 0
      }

      const result = await runtime.lifecycleService.pruneWorktrees()
      // A kept worktree is the point of the report: the sweep found work in it
      // and left it alone, so the operator can look before removing it.
      for (const kept of result.keptBranches) {
        stdout(`Kept ${kept.branch}: ${kept.reason}`)
      }
      if (result.removedBranches.length === 0) {
        stdout('No closed worktrees to prune.')
        return 0
      }
      stdout(
        `Pruned ${result.removedBranches.length} worktree${result.removedBranches.length === 1 ? '' : 's'}: ${result.removedBranches.join(', ')}`,
      )
      return 0
    }

    if (request.command === 'multiplexer') {
      const { target } = request

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
        prefix: await resolvePrefix(),
      })
      const current = runtime.config.multiplexer

      if (target === null) {
        stdout(current)
        return 0
      }
      if (target === current) {
        stdout(`Already using ${current}.`)
        return 0
      }

      const projectDir = resolve(runtime.projectDir)
      // Built lazily *after* the config flips, so it picks up the new gateway.
      // createRuntime re-reads the config on every call.
      let nextRuntime: WorktreeRuntimeLike | null = null

      const result = await switchMultiplexer(current, target, {
        listOpenBranches: async () =>
          computeOpenBranches({
            worktrees: listProjectWorktrees(runtime),
            windows: await runtime.sessions.listWindows(),
            sessionName: buildProjectSessionName(projectDir),
            projectDir,
          }),
        closeWorktree: (branch) => runtime.lifecycleService.closeWorktree(branch),
        persistMultiplexer: (kind) => persistLocalMultiplexer(projectDir, kind),
        openWorktree: async (branch) => {
          nextRuntime ??= createRuntime({ projectDir: context.projectDir, port: context.port })
          await nextRuntime.lifecycleService.openWorktree(branch)
        },
        onProgress: (progress) => {
          if (progress.stage === 'persist') stdout(`Switching config to ${target}`)
          else if (progress.stage === 'close') stdout(`Closing ${progress.branch}`)
          else stdout(`Reopening ${progress.branch}`)
        },
      })

      if (!result.ok) {
        stderr(result.error)
        for (const failure of result.failures) stderr(`  ${failure.branch}: ${failure.message}`)
        return 1
      }
      if (!result.changed) {
        stdout(`Already using ${result.multiplexer}.`)
        return 0
      }

      stdout(`Switched ${result.from} → ${result.to} (${result.restored.length}/${result.closed.length} reopened)`)
      for (const failure of result.failures) {
        stderr(`Failed to reopen ${failure.branch}: ${failure.message}`)
      }
      if (result.restored.length > 0) {
        stdout(
          'Restart the host daemon (`portta host service restart`, or `portta host serve` again) so it picks up the new multiplexer.',
        )
      }
      return result.failures.length > 0 ? 1 : 0
    }

    if (request.command === 'restore') {
      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
        prefix: await resolvePrefix(),
      })
      const projectDir = resolve(runtime.projectDir)
      const gitDir = runtime.git.resolveWorktreeGitDir(projectDir)
      const state = await readOpenSessions(gitDir)

      if (state.branches.length === 0) {
        stdout('No saved sessions to restore.')
        return 0
      }

      const sessionName = buildProjectSessionName(projectDir)
      let openWindows = new Set<string>()
      try {
        openWindows = new Set(
          (await runtime.sessions.listWindows()).filter((w) => w.sessionName === sessionName).map((w) => w.windowName),
        )
      } catch {
        openWindows = new Set()
      }

      const existingBranches = new Set(
        listProjectWorktrees(runtime).map((entry) => entry.branch ?? basename(entry.path)),
      )

      let restored = 0
      let skipped = 0
      let failed = 0
      let firstRestored: string | null = null

      for (const branch of state.branches) {
        if (openWindows.has(buildWorktreeWindowName(branch))) {
          stdout(`Already open: ${branch}`)
          skipped++
          continue
        }
        if (!existingBranches.has(branch)) {
          stderr(`Skipping ${branch}: worktree no longer exists`)
          skipped++
          continue
        }
        try {
          await runtime.lifecycleService.openWorktree(branch)
          stdout(`Restored ${branch}`)
          restored++
          if (!firstRestored) firstRestored = branch
        } catch (error) {
          stderr(`Failed to restore ${branch}: ${error instanceof Error ? error.message : String(error)}`)
          failed++
        }
      }

      const summaryParts = [`Restored ${restored} session${restored === 1 ? '' : 's'}`]
      if (skipped > 0) summaryParts.push(`skipped ${skipped}`)
      if (failed > 0) summaryParts.push(`${failed} failed`)
      stdout(`${summaryParts.join(', ')}.`)

      if (firstRestored) {
        await focusAndSwitch(runtime, firstRestored, switchToSessionWindow)
      }
      return failed > 0 ? 1 : 0
    }

    if (request.command === 'send') {
      const parsed = request.send

      const api = flowApi(
        await withServerConnection(context.port, () => resolveBaseUrl(context.port, context.projectDir)),
      )
      await withServerConnection(context.port, () =>
        api.sendWorktreePrompt({
          params: { name: parsed.branch },
          body: {
            text: parsed.text,
            ...(parsed.preamble ? { preamble: parsed.preamble } : {}),
          },
        }),
      )

      stdout(`Sent prompt to ${parsed.branch}`)
      return 0
    }

    if (request.command === 'tab') {
      const parsed = request.tab

      const api = flowApi(
        await withServerConnection(context.port, () => resolveBaseUrl(context.port, context.projectDir)),
      )
      await withServerConnection(context.port, async () => {
        if (parsed.action === 'new') {
          const { tab } = await api.createWorktreeTab({ params: { name: parsed.branch } })
          stdout(`Created ${tab.label} (${tab.tabId}) in ${parsed.branch}`)
          return
        }
        if (parsed.action === 'switch' || parsed.action === 'close') {
          const tabId = parsed.tabId
          if (!tabId) throw new CommandUsageError(`The "${parsed.action}" action requires a <tabId>`)
          if (parsed.action === 'switch') {
            await api.selectWorktreeTab({ params: { name: parsed.branch, tabId } })
            stdout(`Switched ${parsed.branch} to tab ${tabId}`)
          } else {
            await api.deleteWorktreeTab({ params: { name: parsed.branch, tabId } })
            stdout(`Closed tab ${tabId} in ${parsed.branch}`)
          }
          return
        }
        const { worktrees } = await api.fetchWorktrees()
        const worktree = worktrees.find((candidate) => candidate.branch === parsed.branch)
        if (!worktree) {
          stdout(`Worktree not found: ${parsed.branch}`)
          return
        }
        for (const tab of worktree.tabs) {
          const marker = tab.tabId === worktree.activeTabId ? '★' : ' '
          stdout(`${marker} ${tab.label.padEnd(10)} ${tab.tabId}`)
        }
      })
      return 0
    }

    if (request.command === 'label') {
      const parsed = request.label

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      })
      const result = await runtime.lifecycleService.setWorktreeLabel(parsed.branch, parsed.label)
      stdout(
        result.label ? `Labeled worktree ${parsed.branch} as "${result.label}"` : `Cleared label for ${parsed.branch}`,
      )
      return 0
    }

    if (request.command === 'profile') {
      const parsed = request.profile

      // Switching profiles reopens the worktree, which rewrites control.env —
      // so it needs the prefixed control URL, same as open/refresh.
      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
        prefix: await resolvePrefix(),
      })
      const result = await runtime.lifecycleService.setWorktreeProfile(parsed.branch, parsed.profile)
      stdout(
        result.restarted
          ? `Switched ${parsed.branch} to profile "${result.profile}" and restarted the session`
          : `Switched ${parsed.branch} to profile "${result.profile}" — applies on next open`,
      )
      return 0
    }

    const { command, branch } = request
    const openInput = request.command === 'open' ? request : null

    // open/refresh rewrite control.env, so they need the prefixed control URL;
    // the rest (close/archive/unarchive/remove/merge) don't touch it.
    const needsPrefix = command === 'open' || command === 'refresh'
    const runtime = createRuntime({
      projectDir: context.projectDir,
      port: context.port,
      prefix: needsPrefix ? await resolvePrefix() : undefined,
    })

    switch (command) {
      case 'open':
        await runtime.lifecycleService.openWorktree(
          branch,
          openInput?.interfaceMode ? { interfaceMode: openInput.interfaceMode } : undefined,
        )
        stdout(`Opened worktree ${branch}`)
        await focusAndSwitch(runtime, branch, switchToSessionWindow)
        return 0
      case 'close':
        await runtime.lifecycleService.closeWorktree(branch)
        stdout(`Closed worktree ${branch}`)
        return 0
      case 'refresh':
        await runtime.lifecycleService.refreshAgentTerminal(branch)
        stdout(`Refreshed agent terminal for ${branch}`)
        return 0
      case 'archive':
        await runtime.lifecycleService.setWorktreeArchived(branch, true)
        stdout(`Archived worktree ${branch}`)
        return 0
      case 'unarchive':
        await runtime.lifecycleService.setWorktreeArchived(branch, false)
        stdout(`Restored worktree ${branch}`)
        return 0
      case 'remove':
        await runtime.lifecycleService.removeWorktree(branch, {
          force: request.command === 'remove' && request.force,
        })
        stdout(`Removed worktree ${branch}`)
        return 0
      case 'merge':
        await runtime.lifecycleService.mergeWorktree(branch)
        stdout(`Merged ${branch} into ${runtime.config.workspace.mainBranch}`)
        return 0
    }
  } catch (error) {
    stderr(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

export type EnvironmentAction = (typeof ENVIRONMENT_ACTIONS)[number]

export interface EnvironmentRequest {
  /** A worktree branch, or a Run id when `byRun`. */
  target: string
  byRun: boolean
  action: EnvironmentAction
  /** Arguments after the action, `--` already removed. */
  operands: string[]
  wait: boolean
  copy: boolean
}

/** `environment <branch> [action] [args...]` or `environment --run <id> [action] [args...]`. */
export function environmentFromCli(action: FlowAction): EnvironmentRequest {
  const [branch, requested, rest] = action.args as [string | undefined, string | undefined, string[] | undefined]
  const runId = action.options.run as string | undefined
  const positional = [branch, requested, ...(rest ?? [])].filter((value): value is string => value !== undefined)
  const target = runId ?? positional.shift()
  if (!target) throw new CommandUsageError('environment requires a <branch> or --run <run-id>')
  const name = positional.shift() ?? 'status'
  if (!(ENVIRONMENT_ACTIONS as readonly string[]).includes(name)) {
    throw new CommandUsageError(`Unknown environment action: ${name}`)
  }
  return {
    target,
    byRun: runId !== undefined,
    action: name as EnvironmentAction,
    operands: positional,
    wait: Boolean(action.options.wait),
    copy: Boolean(action.options.copy),
  }
}

export interface EnvironmentCommandApi {
  fetchRun(input: { params: { runId: string } }): Promise<{ run: { environmentId?: string | null } }>
  fetchWorktrees(): Promise<{ worktrees: Array<{ branch: string; environmentId?: string | null }> }>
  fetchEnvironmentServices(input: { params: { environmentId: string } }): Promise<EnvironmentServicesResponse>
  execEnvironment(input: {
    params: { environmentId: string }
    body: EnvironmentExecRequest
  }): Promise<EnvironmentExecResponse>
  openEnvironmentTerminal(input: { params: { environmentId: string } }): Promise<EnvironmentTerminalResponse>
  fetchEnvironmentLogs(input: { params: { environmentId: string } }): Promise<EnvironmentTerminalResponse>
  trustEnvironment(input: { params: { environmentId: string } }): Promise<EnvironmentResponse>
  startEnvironment(input: { params: { environmentId: string } }): Promise<EnvironmentResponse>
  stopEnvironment(input: { params: { environmentId: string } }): Promise<EnvironmentResponse>
  rebuildEnvironment(input: { params: { environmentId: string } }): Promise<EnvironmentResponse>
  removeEnvironment(input: { params: { environmentId: string } }): Promise<OkResponse>
  fetchEnvironment(input: { params: { environmentId: string } }): Promise<EnvironmentResponse>
  exposeEnvironmentService(input: {
    params: { environmentId: string; serviceId: string }
    body: EnvironmentExposeRequest
  }): Promise<EnvironmentServicesResponse>
  controlEnvironmentService(input: {
    params: { environmentId: string; serviceId: string }
    body: { action: 'start' | 'stop' | 'restart' }
  }): Promise<EnvironmentServicesResponse>
  removeEndpoint(input: { params: { endpointId: string } }): Promise<OkResponse>
}

export interface EnvironmentCommandDependencies {
  resolveBaseUrl(port: number, projectDir: string): Promise<string>
  createClient(baseUrl: string): EnvironmentCommandApi
}

const defaultEnvironmentCommandDependencies: EnvironmentCommandDependencies = {
  resolveBaseUrl: async (port, projectDir) =>
    environmentBaseUrlFromControlUrl(process.env[ENV_NAMES.controlUrl]) ?? resolveProjectBaseUrl(port, projectDir),
  createClient: flowApi,
}

export function environmentBaseUrlFromControlUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const suffix = '/api/runtime/events'
    if (!url.pathname.endsWith(suffix)) return null
    const projectPath = url.pathname.slice(0, -suffix.length)
    return `${url.origin}${projectPath}`
  } catch {
    return null
  }
}

/** Hand the terminal to a provider command the server described, returning its exit code. */
async function runInherited(invocation: EnvironmentTerminalResponse): Promise<number> {
  const result = await runProcess(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: 'inherit',
    reject: false,
  })
  if (result.error) throw new Error(result.error)
  return result.exitCode
}

async function writeClipboard(value: string): Promise<boolean> {
  const command = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'win32' ? 'clip' : 'xclip'
  const args = process.platform === 'linux' ? ['-selection', 'clipboard'] : []
  return (await runProcess(command, args, { input: value, reject: false })).exitCode === 0
}

export async function runEnvironmentCommand(
  request: EnvironmentRequest,
  port: number,
  projectDir: string,
  stdout: (message: string) => void = console.log,
  stderr: (message: string) => void = console.error,
  dependencies: EnvironmentCommandDependencies = defaultEnvironmentCommandDependencies,
): Promise<number> {
  try {
    const { target, byRun, action, operands } = request
    const baseUrl = await dependencies.resolveBaseUrl(port, projectDir)
    const api = dependencies.createClient(baseUrl)
    const resolveEnvironmentId = async (): Promise<string | null | undefined> =>
      byRun
        ? (await api.fetchRun({ params: { runId: target } })).run.environmentId
        : (await api.fetchWorktrees()).worktrees.find((worktree) => worktree.branch === target)?.environmentId
    let environmentId: string | null | undefined
    try {
      environmentId = await resolveEnvironmentId()
    } catch (error: unknown) {
      if (action !== 'monitor') throw error
    }
    if (!environmentId && action === 'monitor') {
      for (let attempt = 0; attempt < 120 && !environmentId; attempt += 1) {
        await delay(250)
        try {
          environmentId = await resolveEnvironmentId()
        } catch {
          environmentId = null
        }
      }
    }
    if (!environmentId)
      throw new CommandUsageError(`No environment is associated with ${byRun ? `Run ${target}` : target}`)

    if (action === 'services' || action === 'open' || action === 'expose') {
      const { services } = await withServerConnection(port, () =>
        api.fetchEnvironmentServices({ params: { environmentId } }),
      )
      if (action === 'services') {
        for (const service of services) {
          const urls = service.endpoints.map((endpoint) => endpoint.url).join(', ')
          stdout(`${service.name}\t${service.status}\t${urls || '-'}`)
        }
        return 0
      }
      const serviceName = operands[0]
      if (!serviceName) throw new CommandUsageError(`environment ${action} requires a <service>`)
      const selectedService = services.find((service) => service.name === serviceName)
      if (!selectedService) throw new CommandUsageError(`Environment service not found: ${serviceName}`)
      if (action === 'expose') {
        const exposed = await withServerConnection(port, () =>
          api.exposeEnvironmentService({
            params: { environmentId, serviceId: selectedService.id },
            body: { visibility: 'private' },
          }),
        )
        const endpoint = exposed.services
          .find((service) => service.id === selectedService.id)
          ?.endpoints.find((item) => item.audiences.includes('user'))
        if (!endpoint) throw new Error(`No user endpoint was created for ${serviceName}`)
        stdout(endpoint.url)
        return 0
      }
      const endpoint = selectedService.endpoints.find((item) => item.audiences.includes('user'))
      if (!endpoint) throw new CommandUsageError(`No user endpoint exists for ${serviceName}`)
      if (request.copy) {
        if (!(await writeClipboard(endpoint.url))) throw new Error('Clipboard command failed')
      } else {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
        const openerArgs = process.platform === 'win32' ? ['/c', 'start', '', endpoint.url] : [endpoint.url]
        if ((await runProcess(opener, openerArgs, { reject: false })).exitCode !== 0) {
          throw new Error('Browser open command failed')
        }
      }
      stdout(endpoint.url)
      return 0
    }

    if (action === 'revoke') {
      const endpointId = operands[0]
      if (!endpointId) throw new CommandUsageError('environment revoke requires an <endpoint-id>')
      await withServerConnection(port, () => api.removeEndpoint({ params: { endpointId } }))
      stdout(`Revoked ${endpointId}`)
      return 0
    }

    if (action === 'service') {
      const [serviceName, serviceAction] = operands
      if (!serviceName || (serviceAction !== 'start' && serviceAction !== 'stop' && serviceAction !== 'restart')) {
        throw new CommandUsageError('environment service requires <service> <start|stop|restart>')
      }
      const { services } = await withServerConnection(port, () =>
        api.fetchEnvironmentServices({ params: { environmentId } }),
      )
      const service = services.find((candidate) => candidate.name === serviceName)
      if (!service) throw new CommandUsageError(`Environment service not found: ${serviceName}`)
      if (!service.actions.includes(serviceAction)) {
        throw new CommandUsageError(`Service action is unavailable for ${serviceName}`)
      }
      const updated = await withServerConnection(port, () =>
        api.controlEnvironmentService({
          params: { environmentId, serviceId: service.id },
          body: { action: serviceAction },
        }),
      )
      const changed = updated.services.find((candidate) => candidate.id === service.id)
      stdout(`${serviceName}\t${changed?.status ?? 'unknown'}`)
      return 0
    }

    if (action === 'exec') {
      const [command, ...commandArgs] = operands
      if (!command) throw new CommandUsageError('environment exec requires a command after --')
      const result = await withServerConnection(port, () =>
        api.execEnvironment({ params: { environmentId }, body: { argv: [command, ...commandArgs] } }),
      )
      if (result.stdout) stdout(result.stdout.replace(/\n$/, ''))
      if (result.stderr) stderr(result.stderr.replace(/\n$/, ''))
      return result.code ?? 1
    }

    if (action === 'terminal') {
      const invocation = await withServerConnection(port, () =>
        api.openEnvironmentTerminal({ params: { environmentId } }),
      )
      return runInherited(invocation)
    }

    if (action === 'logs') {
      const waitForReady = request.wait
      let invocation: EnvironmentTerminalResponse | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt < (waitForReady ? 60 : 1); attempt += 1) {
        try {
          invocation = await withServerConnection(port, () => api.fetchEnvironmentLogs({ params: { environmentId } }))
          break
        } catch (error: unknown) {
          lastError = error
          if (!waitForReady) throw error
          await delay(500)
        }
      }
      if (!invocation) throw lastError instanceof Error ? lastError : new Error('Environment logs are unavailable')
      return runInherited(invocation)
    }

    if (action === 'monitor') {
      let lastStatus: string | null = null
      for (;;) {
        const current = await withServerConnection(port, () => api.fetchEnvironment({ params: { environmentId } }))
        const status = current.environment.status
        const statusChanged = status !== lastStatus
        if (statusChanged) {
          stdout(`Runtime\t${current.environment.provider}\t${status}`)
          lastStatus = status
        }
        if (status === 'ready') {
          const invocation = await withServerConnection(port, () =>
            api.fetchEnvironmentLogs({ params: { environmentId } }),
          )
          await runInherited(invocation)
          await delay(500)
          continue
        }
        if (status === 'awaiting_trust') {
          if (statusChanged) {
            stdout(`Review this Runtime in Taskflow, or run ${flowInvocation()} environment ${target} trust.`)
          }
          await delay(500)
          continue
        }
        if (status === 'stopped') {
          stdout(`Runtime stopped. Run ${flowInvocation()} environment ${target} start to start it again.`)
          return 0
        }
        if (status === 'failed' || status === 'missing') return 1
        await delay(500)
      }
    }

    const calls = {
      trust: () => api.trustEnvironment({ params: { environmentId } }),
      start: () => api.startEnvironment({ params: { environmentId } }),
      stop: () => api.stopEnvironment({ params: { environmentId } }),
      rebuild: () => api.rebuildEnvironment({ params: { environmentId } }),
    }
    if (action === 'destroy') {
      await withServerConnection(port, () => api.removeEnvironment({ params: { environmentId } }))
      stdout(`Destroyed ${environmentId}`)
      return 0
    }
    if (action === 'restart') {
      await withServerConnection(port, () => calls.stop())
      const restarted = await withServerConnection(port, () => calls.start())
      stdout(`${restarted.environment.id}\t${restarted.environment.status}`)
      return 0
    }
    let result = null
    if (action === 'status' || action === 'doctor') {
      result = await withServerConnection(port, () => api.fetchEnvironment({ params: { environmentId } }))
    } else if (action === 'trust') result = await withServerConnection(port, calls.trust)
    else if (action === 'start') result = await withServerConnection(port, calls.start)
    else if (action === 'stop') result = await withServerConnection(port, calls.stop)
    else if (action === 'rebuild') result = await withServerConnection(port, calls.rebuild)
    if (!result) throw new CommandUsageError(`Unknown environment action: ${action}`)
    stdout(`${result.environment.id}\t${result.environment.provider}\t${result.environment.status}`)
    if (action === 'doctor') {
      for (const reason of result.environment.security.reasons) stdout(`warning\t${reason}`)
      for (const diagnostic of result.environment.runtimeOverride?.diagnostics ?? [])
        stdout(`diagnostic\t${diagnostic}`)
      if (result.environment.runtimeOverride)
        stdout(
          `runtime-override\t${result.environment.runtimeOverride.path}\t${result.environment.runtimeOverride.hash}\t${result.environment.runtimeOverride.validated ? 'validated' : 'unvalidated'}`,
        )
      if (result.environment.error) stdout(`error\t${result.environment.error}`)
    }
    return 0
  } catch (error) {
    stderr(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
