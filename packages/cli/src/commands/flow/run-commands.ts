import {
  type AgentPermissionMode,
  type AgentTransport,
  type JsonValue,
  type StdioMcpServer,
  StdioMcpServerSchema,
  type WorkspaceSelection,
  type WorkspaceStrategy,
} from 'portta-contracts/taskflow'
import { flowApi } from './daemon.ts'
import type { FlowAction } from './flow-action.ts'
import { CommandUsageError, formatServerError, resolveProjectBaseUrl, withServerConnection } from './shared.ts'

export type ParsedRunCommand =
  | { command: 'workflows'; action: 'list' }
  | { command: 'runs'; action: 'list' }
  | { command: 'runs'; action: 'show' | 'cancel' | 'resume'; runId: string }
  | { command: 'runs'; action: 'permission'; runId: string; requestId: string; optionId: string | null }
  | { command: 'runs'; action: 'transcript'; executionId: string }
  | {
      command: 'runs'
      action: 'create'
      mode: 'workflow'
      workflowId: string
      input: JsonValue
      profile?: string
      workspace?: WorkspaceSelection
      transport?: AgentTransport
      permissionMode?: AgentPermissionMode
      mcpServers?: StdioMcpServer[]
    }
  | {
      command: 'runs'
      action: 'create'
      mode: 'direct'
      harness: string
      input: JsonValue
      profile?: string
      provider?: string
      model?: string
      workspace?: WorkspaceSelection
      transport?: AgentTransport
      permissionMode?: AgentPermissionMode
      mcpServers?: StdioMcpServer[]
    }

function parseJson(value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as JsonValue
  } catch {
    throw new CommandUsageError('--input-json must be a JSON object')
  }
}

export interface RunCreateCliOptions {
  input?: string
  inputJson?: string
  profile?: string
  harness?: string
  provider?: string
  model?: string
  workspace?: string
  branch?: string
  base?: string
  transport?: string
  permissionMode?: string
  mcpJson?: string
}

/** `target` is a workflow id, or `direct` for a Direct Session. */
export function buildRunCreate(target: string, options: RunCreateCliOptions): ParsedRunCommand {
  if (options.input !== undefined && options.inputJson !== undefined) {
    throw new CommandUsageError('Use only one of --input or --input-json')
  }
  const input: JsonValue = options.inputJson !== undefined ? parseJson(options.inputJson) : (options.input ?? '')
  const { profile, harness, provider, model, branch, base: baseBranch } = options
  let transport: AgentTransport | undefined
  if (options.transport !== undefined) {
    if (options.transport !== 'native' && options.transport !== 'acp')
      throw new CommandUsageError('--transport must be native or acp')
    transport = options.transport
  }
  let permissionMode: AgentPermissionMode | undefined
  if (options.permissionMode !== undefined) {
    const value = options.permissionMode
    if (value !== 'interactive' && value !== 'workspace' && value !== 'deny')
      throw new CommandUsageError('--permission-mode must be interactive, workspace, or deny')
    permissionMode = value
  }
  let mcpServers: StdioMcpServer[] | undefined
  if (options.mcpJson !== undefined) {
    try {
      mcpServers = StdioMcpServerSchema.array().parse(JSON.parse(options.mcpJson))
    } catch {
      throw new CommandUsageError('--mcp-json must be a valid stdio MCP server array')
    }
  }
  let workspaceStrategy: WorkspaceStrategy | undefined
  if (options.workspace !== undefined) {
    const value = options.workspace
    if (value !== 'worktree' && value !== 'branch' && value !== 'current')
      throw new CommandUsageError('--workspace must be worktree, branch, or current')
    workspaceStrategy =
      value === 'worktree' ? 'isolated_worktree' : value === 'branch' ? 'new_branch' : 'current_branch'
  }
  if (workspaceStrategy === 'current_branch' && (branch || baseBranch))
    throw new CommandUsageError('--branch and --base do not apply to --workspace current')
  if (workspaceStrategy === undefined && (branch || baseBranch)) workspaceStrategy = 'isolated_worktree'
  const workspace: WorkspaceSelection | undefined =
    workspaceStrategy === undefined
      ? undefined
      : workspaceStrategy === 'current_branch'
        ? { strategy: 'current_branch' }
        : { strategy: workspaceStrategy, ...(branch ? { branch } : {}), ...(baseBranch ? { baseBranch } : {}) }
  if (target !== 'direct' && permissionMode === 'interactive')
    throw new CommandUsageError('--permission-mode interactive is only available for Direct Runs')
  if (target !== 'direct')
    return {
      command: 'runs',
      action: 'create',
      mode: 'workflow',
      workflowId: target,
      input,
      ...(profile ? { profile } : {}),
      ...(workspace ? { workspace } : {}),
      ...(transport ? { transport } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(mcpServers ? { mcpServers } : {}),
    }
  if (!harness) throw new CommandUsageError('run direct requires --harness <agent>')
  return {
    command: 'runs',
    action: 'create',
    mode: 'direct',
    harness,
    input,
    ...(profile ? { profile } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(workspace ? { workspace } : {}),
    ...(transport ? { transport } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(mcpServers ? { mcpServers } : {}),
  }
}

export function runCommandFromCli(action: FlowAction): ParsedRunCommand {
  const [command, subcommand] = action.path
  const [first = '', second = '', third = ''] = action.args.map(String)
  if (command === 'workflows') return { command, action: 'list' }
  if (command === 'run') return buildRunCreate(subcommand === 'direct' ? 'direct' : first, action.options)
  switch (subcommand) {
    case 'show':
    case 'cancel':
    case 'resume':
      return { command: 'runs', action: subcommand, runId: first }
    case 'transcript':
      return { command: 'runs', action: subcommand, executionId: first }
    case 'permission':
      return {
        command: 'runs',
        action: subcommand,
        runId: first,
        requestId: second,
        optionId: third === 'deny' ? null : third,
      }
    default:
      return { command: 'runs', action: 'list' }
  }
}

function projectId(baseUrl: string): string {
  const id = new URL(baseUrl).pathname.split('/').filter(Boolean).at(-1)
  if (!id) throw new CommandUsageError('Could not resolve the served project id')
  return id
}

export interface RunCommandDependencies {
  resolveBaseUrl?: (port: number) => Promise<string>
  stdout?: (message: string) => void
  stderr?: (message: string) => void
  createOperationId?: () => string
}

export async function runRunCommand(
  parsed: ParsedRunCommand,
  port: number,
  dependencies: RunCommandDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log
  const stderr = dependencies.stderr ?? console.error
  try {
    const baseUrl = await withServerConnection(port, () => (dependencies.resolveBaseUrl ?? resolveProjectBaseUrl)(port))
    const api = flowApi(baseUrl)
    if (parsed.command === 'workflows') {
      const response = await withServerConnection(port, () =>
        api.fetchProjectWorkflows({ params: { projectId: projectId(baseUrl) } }),
      )
      stdout(JSON.stringify(response.workflows, null, 2))
      return 0
    }
    if (parsed.action === 'list') {
      const response = await withServerConnection(port, () =>
        api.fetchProjectRuns({ params: { projectId: projectId(baseUrl) } }),
      )
      stdout(JSON.stringify(response.runs, null, 2))
      return 0
    }
    if (parsed.action === 'show') {
      const response = await withServerConnection(port, () => api.fetchRun({ params: { runId: parsed.runId } }))
      stdout(JSON.stringify(response.run, null, 2))
      return 0
    }
    if (parsed.action === 'transcript') {
      const response = await withServerConnection(port, () =>
        api.fetchExecutionTranscript({ params: { executionId: parsed.executionId }, query: {} }),
      )
      stdout(JSON.stringify(response, null, 2))
      return 0
    }
    if (parsed.action === 'permission') {
      const response = await withServerConnection(port, () =>
        api.respondRunPermission({
          params: { runId: parsed.runId },
          body: { requestId: parsed.requestId, optionId: parsed.optionId },
        }),
      )
      stdout(JSON.stringify(response.run, null, 2))
      return 0
    }
    if (parsed.action === 'create') {
      const response = await withServerConnection(port, () =>
        api.createProjectRun({
          params: { projectId: projectId(baseUrl) },
          body:
            parsed.mode === 'workflow'
              ? {
                  mode: parsed.mode,
                  workflowId: parsed.workflowId,
                  input: parsed.input,
                  ...(parsed.profile ? { profile: parsed.profile } : {}),
                  ...(parsed.workspace ? { workspace: parsed.workspace } : {}),
                  ...(parsed.transport ? { transport: parsed.transport } : {}),
                  ...(parsed.permissionMode
                    ? { permissionMode: parsed.permissionMode === 'deny' ? 'deny' : 'workspace' }
                    : {}),
                  ...(parsed.mcpServers ? { mcpServers: parsed.mcpServers } : {}),
                  idempotencyKey: dependencies.createOperationId?.() ?? crypto.randomUUID(),
                }
              : {
                  mode: parsed.mode,
                  harness: parsed.harness,
                  input: parsed.input,
                  ...(parsed.profile ? { profile: parsed.profile } : {}),
                  ...(parsed.provider ? { provider: parsed.provider } : {}),
                  ...(parsed.model ? { model: parsed.model } : {}),
                  ...(parsed.workspace ? { workspace: parsed.workspace } : {}),
                  ...(parsed.transport ? { transport: parsed.transport } : {}),
                  ...(parsed.permissionMode ? { permissionMode: parsed.permissionMode } : {}),
                  ...(parsed.mcpServers ? { mcpServers: parsed.mcpServers } : {}),
                  idempotencyKey: dependencies.createOperationId?.() ?? crypto.randomUUID(),
                },
        }),
      )
      stdout(JSON.stringify(response.run, null, 2))
      return 0
    }
    const response =
      parsed.action === 'cancel'
        ? await withServerConnection(port, () =>
            api.cancelRun({
              params: { runId: parsed.runId },
              body: { idempotencyKey: dependencies.createOperationId?.() ?? crypto.randomUUID() },
            }),
          )
        : await withServerConnection(port, () =>
            api.resumeRun({
              params: { runId: parsed.runId },
              body: { idempotencyKey: dependencies.createOperationId?.() ?? crypto.randomUUID() },
            }),
          )
    stdout(JSON.stringify(response.run, null, 2))
    return 0
  } catch (error: unknown) {
    stderr(error instanceof CommandUsageError ? error.message : formatServerError(error, port))
    return 1
  }
}
