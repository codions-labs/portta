import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeSelection } from 'portta-core/taskflow'
import {
  APP_DEFAULTS,
  APP_NAME,
  APP_SLUG,
  ENV_NAMES,
  LINEAR_IDENTITY,
  PROJECT_CONFIG_PATH,
} from 'portta-core/taskflow/config'
import { NodeProcessRunner } from '../adapters/process-runner.ts'
import { hostToolInvocation } from '../lib/host-tools.ts'
import { detectProjectName, run } from '../lib/shell.ts'
import { isRecord } from '../lib/type-guards.ts'

export type InitAuthoringChoice = 'claude' | 'codex' | 'manual'
export type InitAgent = Exclude<InitAuthoringChoice, 'manual'>
export type InitPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'

export interface InitProjectContext {
  gitRoot: string
  projectName: string
  mainBranch: string
  defaultAgent: InitAgent
  packageManager: InitPackageManager
}

export interface InitDetection {
  devcontainerConfigs: string[]
  composeFiles: string[]
  dockerfile: boolean
  packageJson: boolean
  selectedRuntime: RuntimeSelection
}

export interface InitPromptSpec {
  systemPrompt: string
  userPrompt: string
}

export interface InitAgentCommandSpec {
  agent: InitAgent
  cmd: string
  args: string[]
  summaryPath?: string
}

export interface InitAgentStreamEvent {
  kind: 'assistant_delta' | 'assistant_done' | 'status' | 'warning'
  text: string
}

export interface InitAgentRunResult {
  exitCode: number
  stdout: string
  stderr: string
  summary: string
}

export interface InitAgentRunHandlers {
  onEvent?: (event: InitAgentStreamEvent) => void
  /** Kill the agent if it runs longer than this (ms). Used server-side so a
   *  hung analysis can't stall project setup forever. */
  timeoutMs?: number
}

interface InitAgentStreamState {
  assistantSnapshot: string
  lastStatus: string | null
}

const FAST_CLAUDE_MODEL = 'haiku'
const FAST_CLAUDE_EFFORT = 'low'
const FAST_CODEX_REASONING = 'low'

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function detectPackageManager(gitRoot: string): InitPackageManager {
  if (existsSync(join(gitRoot, 'bun.lock')) || existsSync(join(gitRoot, 'bun.lockb'))) return 'bun'
  if (existsSync(join(gitRoot, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(gitRoot, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function detectMainBranch(gitRoot: string): string {
  const currentBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitRoot })
  if (currentBranch.success) {
    const branch = currentBranch.stdout.toString().trim()
    if (branch && branch !== 'HEAD') return branch
  }

  const originHead = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: gitRoot })
  if (originHead.success) {
    const branch = originHead.stdout.toString().trim().split('/').pop()
    if (branch) return branch
  }

  const mainBranch = run('git', ['branch', '--list', 'main'], { cwd: gitRoot })
  if (mainBranch.success && mainBranch.stdout.toString().trim()) return 'main'

  const masterBranch = run('git', ['branch', '--list', 'master'], { cwd: gitRoot })
  if (masterBranch.success && masterBranch.stdout.toString().trim()) return 'master'

  return APP_DEFAULTS.mainBranch
}

function buildRunScriptCommand(packageManager: InitPackageManager, scriptName: 'dev' | 'start'): string {
  if (packageManager === 'bun') return `bun run ${scriptName}`
  if (packageManager === 'pnpm') return `pnpm ${scriptName}`
  if (packageManager === 'yarn') return `yarn ${scriptName}`
  return `npm run ${scriptName}`
}

export function detectInitProjectContext(gitRoot: string, defaultAgent: InitAgent): InitProjectContext {
  return {
    gitRoot,
    projectName: detectProjectName(gitRoot),
    mainBranch: detectMainBranch(gitRoot),
    defaultAgent,
    packageManager: detectPackageManager(gitRoot),
  }
}

export function detectInitEnvironment(gitRoot: string, requested: RuntimeSelection = 'auto'): InitDetection {
  const devcontainerConfigs = ['.devcontainer.json', '.devcontainer/devcontainer.json'].filter((path) =>
    existsSync(join(gitRoot, path)),
  )
  const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'].filter((path) =>
    existsSync(join(gitRoot, path)),
  )
  const selectedRuntime =
    requested !== 'auto'
      ? requested
      : devcontainerConfigs.length === 1
        ? 'devcontainer'
        : composeFiles.length > 0
          ? 'compose'
          : existsSync(join(gitRoot, 'Dockerfile'))
            ? 'dockerfile'
            : 'host'
  return {
    devcontainerConfigs,
    composeFiles,
    dockerfile: existsSync(join(gitRoot, 'Dockerfile')),
    packageJson: existsSync(join(gitRoot, 'package.json')),
    selectedRuntime,
  }
}

export function buildInitPromptSpec(context: InitProjectContext): InitPromptSpec {
  const systemPrompt = [
    `You are bootstrapping a local repository for ${APP_NAME}.`,
    `A starter \`${PROJECT_CONFIG_PATH}\` already exists at the repo root.`,
    `Inspect the repository in the current working directory and edit that existing \`${PROJECT_CONFIG_PATH}\` in place.`,
    'Do not modify any other file.',
    'Do not ask the user questions. Infer the config from the repository contents.',
    'Be efficient: inspect only the files needed to determine the project name, main branch, service layout, dev commands, and ports.',
    'The active, uncommented YAML must be valid and minimal.',
    'Do not remove other starter sections or their explanatory comments just because they are unused.',
    'Keep optional examples and comments in place so the user can uncomment and use them later.',
    `Set workspace.defaultAgent to ${context.defaultAgent}.`,
    'Use this config shape:',
    'name: infer from the repository',
    'workspace.mainBranch: infer from git',
    `workspace.worktrees.root: keep ${APP_DEFAULTS.worktreeRoot} unless there is clear evidence of an existing alternative`,
    'Do not copy detected Compose services or ports into config unless the user needs an explicit override.',
    'Preserve the commented services example: it is for Taskflow-managed host or Docker profile processes, not discovered Dev Container or Compose services.',
    'profiles.default.environment.provider: auto unless the user chose a runtime override. If no Dev Container, Compose, or Dockerfile exists, set it to host.',
    'For a host project, put its one managed development command in profiles.default.environment.command; never add a third app command pane for it.',
    'Only declare services when a host command has a proven port and supports the injected port environment variable. When the port is uncertain, keep the command but omit services.',
    'profiles.default.envPassthrough: []',
    'profiles.default.panes: keep the active agent and runtime panes; runtime follows the selected environment and is where users inspect and control it.',
    'Do not add docker compose command panes when an environment provider can manage the runtime.',
    'Use split: right for the first command pane and split: bottom for later command panes.',
    'Include integrations.github.linkedRepos as an empty list, integrations.linear.enabled as true, and startupEnvs as an empty object.',
    'Only include optional sections like auto_name, lifecycleHooks, sandbox/docker config, mounts, or systemPrompt if the repository gives clear evidence they are needed.',
    'Prefer editing the existing keys over replacing the file with a completely different shape.',
    'Preserve the existing template structure and comments unless a specific change requires updating them.',
    `Before finishing, verify that \`${PROJECT_CONFIG_PATH}\` exists and contains the final YAML.`,
  ].join('\n')

  return {
    systemPrompt,
    userPrompt: `Adapt the existing starter \`${PROJECT_CONFIG_PATH}\` for this repository.`,
  }
}

export function buildInitAgentCommand(
  agent: InitAgent,
  prompt: InitPromptSpec,
  outputPrefix = `${APP_SLUG}-init`,
): InitAgentCommandSpec {
  if (agent === 'claude') {
    return {
      agent,
      cmd: 'claude',
      args: [
        '-p',
        '--verbose',
        '--safe-mode',
        '--disable-slash-commands',
        '--no-session-persistence',
        '--permission-mode',
        'bypassPermissions',
        '--model',
        FAST_CLAUDE_MODEL,
        '--effort',
        FAST_CLAUDE_EFFORT,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--append-system-prompt',
        prompt.systemPrompt,
        prompt.userPrompt,
      ],
    }
  }

  const summaryPath = join(tmpdir(), `${outputPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  return {
    agent,
    cmd: 'codex',
    args: [
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '--json',
      '-o',
      summaryPath,
      '-c',
      `model_reasoning_effort="${FAST_CODEX_REASONING}"`,
      '-c',
      `developer_instructions=${prompt.systemPrompt}`,
      prompt.userPrompt,
    ],
    summaryPath,
  }
}

function closeAssistant(state: InitAgentStreamState): InitAgentStreamEvent[] {
  if (!state.assistantSnapshot) return []
  state.assistantSnapshot = ''
  return [{ kind: 'assistant_done', text: '' }]
}

function streamSnapshot(state: InitAgentStreamState, snapshot: string): InitAgentStreamEvent[] {
  if (!snapshot) return []

  if (!state.assistantSnapshot) {
    state.assistantSnapshot = snapshot
    return [{ kind: 'assistant_delta', text: snapshot }]
  }

  if (snapshot === state.assistantSnapshot) return []

  if (snapshot.startsWith(state.assistantSnapshot)) {
    const delta = snapshot.slice(state.assistantSnapshot.length)
    state.assistantSnapshot = snapshot
    return delta ? [{ kind: 'assistant_delta', text: delta }] : []
  }

  state.assistantSnapshot = snapshot
  return [
    { kind: 'assistant_done', text: '' },
    { kind: 'assistant_delta', text: snapshot },
  ]
}

function emitStatus(state: InitAgentStreamState, text: string | null): InitAgentStreamEvent[] {
  const status = text?.trim()
  if (!status || status === state.lastStatus) return []
  state.lastStatus = status
  return [...closeAssistant(state), { kind: 'status', text: status }]
}

function emitWarning(state: InitAgentStreamState, text: string | null): InitAgentStreamEvent[] {
  const warning = text?.trim()
  if (!warning) return []
  return [...closeAssistant(state), { kind: 'warning', text: warning }]
}

function extractTextBlocks(value: unknown): string {
  if (typeof value === 'string') return value

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractTextBlocks(entry))
      .filter((entry) => entry.length > 0)
      .join('')
  }

  if (!isRecord(value)) return ''

  if (value.type === 'text' && typeof value.text === 'string') {
    return value.text
  }

  if (typeof value.output_text === 'string') return value.output_text
  if (typeof value.text === 'string') return value.text
  if (typeof value.delta === 'string') return value.delta
  if (Array.isArray(value.content)) return extractTextBlocks(value.content)
  if (Array.isArray(value.contents)) return extractTextBlocks(value.contents)
  if (Array.isArray(value.parts)) return extractTextBlocks(value.parts)
  if (Array.isArray(value.output)) return extractTextBlocks(value.output)

  return ''
}

function extractCommandText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.join(' ').trim() || null
  }
  return null
}

function truncateText(text: string, limit = 120): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function extractStructuredMessage(raw: Record<string, unknown>): string | null {
  const candidates: unknown[] = [raw.message, raw.result, raw.item, raw.output, raw.content, raw.text, raw.response]

  for (const candidate of candidates) {
    const text = extractTextBlocks(candidate).trim()
    if (text) return text
  }

  return null
}

function parseClaudeStreamLine(raw: Record<string, unknown>, state: InitAgentStreamState): InitAgentStreamEvent[] {
  const type = readString(raw.type) ?? 'unknown'

  if (type === 'content_block_delta' && isRecord(raw.delta)) {
    if (raw.delta.type === 'text_delta' && typeof raw.delta.text === 'string') {
      return [{ kind: 'assistant_delta', text: raw.delta.text }]
    }
    if (typeof raw.delta.text === 'string') {
      return [{ kind: 'assistant_delta', text: raw.delta.text }]
    }
  }

  if (type === 'content_block_start' && isRecord(raw.content_block)) {
    if (raw.content_block.type === 'tool_use') {
      return emitStatus(state, `Using ${readString(raw.content_block.name) ?? 'tool'}...`)
    }

    const snapshot = extractTextBlocks(raw.content_block).trim()
    return streamSnapshot(state, snapshot)
  }

  if (type === 'message_stop' || type === 'result_stop' || type === 'content_block_stop') {
    return closeAssistant(state)
  }

  if (type === 'error') {
    const message = isRecord(raw.error) ? readString(raw.error.message) : readString(raw.message)
    return emitWarning(state, message ?? 'Claude returned an error.')
  }

  if (type.includes('tool')) {
    const toolName =
      readString(raw.tool_name) ?? (isRecord(raw.tool) ? readString(raw.tool.name) : null) ?? readString(raw.name)
    if (toolName) return emitStatus(state, `Using ${toolName}...`)
  }

  const snapshot = extractStructuredMessage(raw)
  if (snapshot) return streamSnapshot(state, snapshot)

  return []
}

function parseCodexStatus(raw: Record<string, unknown>, type: string): string | null {
  const command = extractCommandText(raw.command) ?? (isRecord(raw.item) ? extractCommandText(raw.item.command) : null)
  if (command && (type.includes('command') || type.includes('exec') || type.includes('shell'))) {
    return `Running ${truncateText(command)}`
  }

  const toolName =
    readString(raw.tool_name) ?? readString(raw.name) ?? (isRecord(raw.item) ? readString(raw.item.name) : null)
  if (toolName && (type.includes('tool') || type.includes('function'))) {
    return `Using ${toolName}...`
  }

  const status = readString(raw.status)
  if (status && !['completed', 'done', 'finished'].includes(status)) {
    return truncateText(status)
  }

  if (type.includes('turn')) return 'Thinking...'
  return null
}

function parseCodexStreamLine(raw: Record<string, unknown>, state: InitAgentStreamState): InitAgentStreamEvent[] {
  const type = readString(raw.type) ?? readString(raw.event) ?? 'unknown'

  if (type === 'response.output_text.delta' && typeof raw.delta === 'string') {
    return [{ kind: 'assistant_delta', text: raw.delta }]
  }

  if (type === 'response.output_text.done') {
    const text = readString(raw.text) ?? extractTextBlocks(raw.item).trim()
    return [...(text ? streamSnapshot(state, text) : []), ...closeAssistant(state)]
  }

  if (type.includes('error')) {
    const message = isRecord(raw.error) ? readString(raw.error.message) : readString(raw.message)
    return emitWarning(state, message ?? 'Codex returned an error.')
  }

  const status = parseCodexStatus(raw, type)
  if (status) return emitStatus(state, status)

  if (type.includes('delta') && typeof raw.delta === 'string') {
    return [{ kind: 'assistant_delta', text: raw.delta }]
  }

  const snapshot = extractStructuredMessage(raw)
  if (
    snapshot &&
    (type.includes('assistant') || type.includes('message') || type.includes('output') || type.includes('response'))
  ) {
    const events = streamSnapshot(state, snapshot)
    if (type.includes('done') || type.includes('completed') || type.includes('finished')) {
      events.push(...closeAssistant(state))
    }
    return events
  }

  if (type.includes('done') || type.includes('completed') || type.includes('finished')) {
    return closeAssistant(state)
  }

  return []
}

export function parseInitAgentStreamLine(
  agent: InitAgent,
  line: string,
  state: InitAgentStreamState = { assistantSnapshot: '', lastStatus: null },
): InitAgentStreamEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }

  if (!isRecord(parsed)) return []
  return agent === 'claude' ? parseClaudeStreamLine(parsed, state) : parseCodexStreamLine(parsed, state)
}

async function consumeStructuredStream(
  stream: ReadableStream<Uint8Array> | null,
  agent: InitAgent,
  onEvent?: (event: InitAgentStreamEvent) => void,
): Promise<{ raw: string; assistantText: string }> {
  if (!stream) return { raw: '', assistantText: '' }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const state: InitAgentStreamState = { assistantSnapshot: '', lastStatus: null }
  let buffer = ''
  let raw = ''
  let assistantText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    raw += text
    buffer += text

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      for (const event of parseInitAgentStreamLine(agent, line, state)) {
        if (event.kind === 'assistant_delta') assistantText += event.text
        onEvent?.(event)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const tail = decoder.decode()
  raw += tail
  buffer += tail

  const finalLine = buffer.replace(/\r$/, '')
  if (finalLine) {
    for (const event of parseInitAgentStreamLine(agent, finalLine, state)) {
      if (event.kind === 'assistant_delta') assistantText += event.text
      onEvent?.(event)
    }
  }

  for (const event of closeAssistant(state)) {
    onEvent?.(event)
  }

  return { raw, assistantText }
}

async function consumeRawStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return ''

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let raw = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    raw += decoder.decode(value, { stream: true })
  }

  return raw + decoder.decode()
}

export async function runInitAgentCommand(
  spec: InitAgentCommandSpec,
  cwd: string,
  handlers: InitAgentRunHandlers = {},
): Promise<InitAgentRunResult> {
  const proc = new NodeProcessRunner().start({
    command: hostToolInvocation(spec.cmd),
    args: spec.args,
    cwd,
    timeoutMs: handlers.timeoutMs,
  })
  const [exit, stdoutResult, stderr] = await Promise.all([
    proc.exited,
    consumeStructuredStream(proc.stdout, spec.agent, handlers.onEvent),
    consumeRawStream(proc.stderr),
  ])
  return finalizeAgentRun(spec, exit.code ?? 1, stdoutResult, stderr)
}

function finalizeAgentRun(
  spec: InitAgentCommandSpec,
  exitCode: number,
  stdoutResult: { raw: string; assistantText: string },
  stderr: string,
): InitAgentRunResult {
  let summary = stdoutResult.assistantText.trim()
  if (spec.summaryPath && existsSync(spec.summaryPath)) {
    try {
      summary = readFileSync(spec.summaryPath, 'utf8').trim() || summary
    } finally {
      rmSync(spec.summaryPath, { force: true })
    }
  }

  return { exitCode, stdout: stdoutResult.raw, stderr, summary }
}

export function buildStarterTemplate(input: {
  projectName: string
  mainBranch: string
  defaultAgent?: InitAgent
  packageManager?: InitPackageManager
  environmentProvider?: RuntimeSelection
}): string {
  const defaultAgent = input.defaultAgent ?? APP_DEFAULTS.defaultAgent
  const packageManager = input.packageManager ?? 'npm'
  const devCommand = buildRunScriptCommand(packageManager, 'dev')
  const environmentProvider = input.environmentProvider ?? 'auto'

  return `# Starter config for ${APP_NAME}.
# Keep the active keys below as a minimal working setup, then uncomment
# the examples to enable more services, profiles, integrations, or hooks.

# Project display name shown in the dashboard and browser title.
name: ${input.projectName}

workspace:
  # Git branch new worktrees start from.
  mainBranch: ${input.mainBranch}
  # Relative or absolute directory where managed worktrees are created.
  worktrees:
    root: ${APP_DEFAULTS.worktreeRoot}
  # Agent new worktrees use by default.
  defaultAgent: ${defaultAgent}
  # Example background pull settings for keeping the main branch fresh.
  # autoPull:
  #   # Turn automatic pulls on or off.
  #   enabled: false
  #   # Seconds between pull attempts.
  #   intervalSeconds: 300

# Taskflow discovers Dev Container, Compose, and Dockerfile services from the resolved runtime.
# Declare services here only for a process started by a host or Docker profile pane
# that accepts an injected port environment variable. Do not duplicate discovered services.
services:
  # Example app service with a predictable port per worktree.
  # - name: app
  #   # Environment variable injected into panes and lifecycle hooks.
  #   portEnv: PORT
  #   # Base port used to derive a unique port for each managed worktree.
  #   portStart: 3000
  #   # Increment between worktree port allocations.
  #   portStep: 10
  #   # Host-reachable URL shown in the dashboard when the process is running.
  #   urlTemplate: http://localhost:\${PORT}

exposure:
  local:
    # Automatically expose detected container ports locally. Use manual to require
    # an explicit action for every service, or http to expose HTTP(S) only.
    autoExpose: all
    # loopback forwards container services to private 127.0.0.1 ports; disabled
    # creates no endpoints at all.
    provider: loopback

# Profiles define runtime, permissions, and tmux pane layout.
profiles:
  default:
    # Panes run on the host; the environment provider controls the development
    # runtime and is automatically resolved from Dev Container, Compose, or Dockerfile.
    runtime: host
    environment:
      provider: ${environmentProvider}
      # For a host-only project, uncomment a single command that the Runtime pane owns.
      # command: ${devCommand}
    # Forward selected host env vars into the agent process.
    envPassthrough:
      # - ANTHROPIC_API_KEY
      # - OPENAI_API_KEY
    # Extra system instructions for the agent in this profile.
    # systemPrompt: >
    #   You are working in \${${ENV_NAMES.worktreePath}}
    # Skip agent permission prompts in this profile.
    # yolo: true
    # Panes define the tmux layout created for each worktree session.
    panes:
      # Main AI coding pane.
      - id: agent
        # Pane type: agent, runtime, command, or shell.
        kind: agent
        # Focus this pane when the session opens.
        focus: true
        # Place this pane to the right of the existing layout.
        # split: right
        # Percent of the available space this pane should take.
        # sizePct: 50
        # Start this pane in the repo root or managed worktree.
        # cwd: worktree
      # Runtime console: follows the selected environment's logs, then becomes
      # an interactive shell for status, restart, terminal, and service commands.
      - id: runtime
        kind: runtime
        split: right
        sizePct: 30
        cwd: worktree
      # Example dev server pane.
      # - id: app
      #   # Pane type: agent, runtime, command, or shell.
      #   kind: command
      #   # Place this pane to the right of the existing layout.
      #   split: right
      #   # Percent of the available space this pane should take.
      #   sizePct: 50
      #   # Start this pane in the repo root or managed worktree.
      #   cwd: worktree
      #   # Change into a subdirectory before running the command.
      #   workingDir: frontend
      #   # Command run when the pane starts. ${APP_NAME} injects $PORT.
      #   command: PORT=$PORT ${devCommand}
      # Example shell pane for manual commands.
      # - id: shell
      #   # Pane type: agent, command, or shell.
      #   kind: shell
      #   # Place this pane below the existing layout.
      #   split: bottom
      #   # Percent of the available space this pane should take.
      #   sizePct: 30
      #   # Start this pane in the repo root or managed worktree.
      #   cwd: repo

  # Example sandbox profile that runs panes inside Docker.
  # sandbox:
  #   # Run panes inside a container instead of on the host.
  #   runtime: docker
  #   # Docker image used for the sandbox container.
  #   image: ghcr.io/your-org/your-image:latest
  #   # Forward selected host env vars into the container.
  #   envPassthrough:
  #     - ANTHROPIC_API_KEY
  #     - OPENAI_API_KEY
  #   # Extra system instructions for the agent in this profile.
  #   systemPrompt: >
  #     Extra instructions for the sandbox profile.
  #   # Skip agent permission prompts in this profile.
  #   yolo: true
  #   # Extra host paths to mount into the container.
  #   mounts:
  #     # Host path mounted into the sandbox.
  #     - hostPath: ~/.codex
  #       # Path inside the container.
  #       guestPath: /root/.codex
  #       # Allow writes through this mount.
  #       writable: true
  #   # Panes define the tmux layout created for sandbox sessions.
  #   panes:
  #     # Main AI coding pane.
  #     - id: agent
  #       # Pane type: agent, command, or shell.
  #       kind: agent
  #       # Focus this pane when the session opens.
  #       focus: true
  #     # Example shell pane for manual commands.
  #     - id: shell
  #       # Pane type: agent, command, or shell.
  #       kind: shell
  #       # Place this pane to the right of the existing layout.
  #       split: right
  #       # Start this pane in the repo root or managed worktree.
  #       cwd: repo

# Integrations connect ${APP_NAME} to external systems.
integrations:
  github:
    # Additional local repos ${APP_NAME} should consider alongside the main repo.
    linkedRepos:
      # GitHub slug for a related repo.
      # - repo: your-org/your-repo
      #   # Short label shown in the UI.
      #   alias: repo
      #   # Relative or absolute path to that local checkout.
      #   dir: ../your-repo
    # Remove managed worktrees automatically when their PR merges.
    # autoRemoveOnMerge: true
  linear:
    # Enable Linear issue lookup and linking in the UI.
    enabled: true
    # Auto-create worktrees for assigned issues labeled "${LINEAR_IDENTITY.label}" or "${LINEAR_IDENTITY.oneshotLabel}".
    # autoCreateWorktrees: true
    # Show a create-ticket action in the dashboard. The team to file into is
    # picked in the dialog at creation time.
    # createTicketOption: true
    # Restrict the auto-create watcher to issues from these teams. Useful when
    # the authenticated Linear user is in multiple teams or when running ${APP_NAME}
    # in several projects on the same machine that share a Linear account.
    # watchTeams: [ENG, OPS]

# startupEnvs become runtime env vars for panes, agents, and hooks.
startupEnvs:
  # Example feature flag available in every worktree session.
  # FEATURE_FLAG: true
  # Example service URL built from allocated ports.
  # API_BASE_URL: http://localhost:\${PORT}

# lifecycleHooks run custom shell commands during worktree lifecycle events.
# lifecycleHooks:
#   # Runs after env setup and before panes start.
#   postCreate: npm install
#   # Runs before the worktree directory is removed.
#   preRemove: tmux kill-session -t "$${ENV_NAMES.worktreeId}" || true

# auto_name lets ${APP_NAME} generate a branch name when one is not provided.
# auto_name:
#   # Provider used for automatic branch naming.
#   provider: ${defaultAgent}
#   # Optional model override. Omit it to use the provider's current default.
#   # model: your-provider-model
#   # Prompt that tells the model how to name branches.
#   system_prompt: >
#     Generate a short kebab-case git branch name.
`
}
