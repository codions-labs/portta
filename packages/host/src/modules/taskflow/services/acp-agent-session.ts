import { randomUUID } from 'node:crypto'
import * as acp from '@agentclientprotocol/sdk'
import type { EnvironmentCommandHandle } from 'portta-core/taskflow'
import type {
  AgentPermissionMode,
  NegotiatedAgentCapabilities,
  StdioMcpServer,
  SupervisedOperationEvent,
} from './agent-runtime-types.ts'

export interface PermissionOption {
  optionId: string
  kind: string
}

export function normalizeAcpCapabilities(raw: acp.AgentCapabilities): NegotiatedAgentCapabilities {
  return {
    loadSession: raw.loadSession === true,
    resumeSession: raw.sessionCapabilities?.resume != null,
    listSessions: raw.sessionCapabilities?.list != null,
    closeSession: raw.sessionCapabilities?.close != null,
    forkSession: raw.sessionCapabilities?.fork != null,
    terminal: true,
    mcp: {
      stdio: true,
      http: raw.mcpCapabilities?.http === true,
      sse: raw.mcpCapabilities?.sse === true,
    },
    raw: JSON.parse(JSON.stringify(raw)),
  }
}

export interface AcpAgentProcess {
  readonly pid?: number
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<{ code: number | null; signal: string | null; timedOut: boolean }>
  write(input: string | Uint8Array): Promise<void>
  closeStdin(): void
  interrupt(): Promise<void>
  kill(): Promise<void>
}

export interface AcpAgentSessionInput {
  process: AcpAgentProcess
  cwd: string
  prompt: string
  sessionId?: string
  permissionMode: AgentPermissionMode
  mcpServers: StdioMcpServer[]
  signal?: AbortSignal
  spawnTerminal(command: string, args: string[], cwd: string, env: Record<string, string>): EnvironmentCommandHandle
  onReady(sessionId: string, capabilities: NegotiatedAgentCapabilities): void
  onEvent(type: string, payload: SupervisedOperationEvent['payload']): void
  requestPermission(toolKind: string, options: PermissionOption[], request: unknown): Promise<string | null>
}

export interface AcpAgentSessionResult {
  sessionId: string
  stopReason: string
  text: string
}

interface ManagedTerminal {
  handle: EnvironmentCommandHandle
  output: string
  truncated: boolean
  limit: number
  exit: { exitCode?: number | null; signal?: string | null } | null
  drained: Promise<void>
}

function jsonValue(value: unknown): SupervisedOperationEvent['payload'] {
  return JSON.parse(JSON.stringify(value)) as SupervisedOperationEvent['payload']
}

function appendTerminalOutput(terminal: ManagedTerminal, text: string): void {
  terminal.output += text
  const encoded = new TextEncoder().encode(terminal.output)
  if (encoded.byteLength <= terminal.limit) return
  terminal.truncated = true
  const retained = encoded.slice(encoded.byteLength - terminal.limit)
  terminal.output = new TextDecoder().decode(retained).replace(/^\uFFFD/, '')
}

async function consumeTerminalStream(
  terminal: ManagedTerminal,
  terminalId: string,
  channel: 'stdout' | 'stderr',
  stream: ReadableStream<Uint8Array>,
  onEvent: AcpAgentSessionInput['onEvent'],
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const item = await reader.read()
    if (item.done) {
      const text = decoder.decode()
      if (text) {
        appendTerminalOutput(terminal, text)
        onEvent('terminal.output', { terminalId, channel, text })
      }
      return
    }
    const text = decoder.decode(item.value, { stream: true })
    appendTerminalOutput(terminal, text)
    onEvent('terminal.output', { terminalId, channel, text })
  }
}

class AcpTerminalRegistry {
  private readonly terminals = new Map<string, ManagedTerminal>()

  private readonly spawn: AcpAgentSessionInput['spawnTerminal']
  private readonly onEvent: AcpAgentSessionInput['onEvent']
  constructor(spawn: AcpAgentSessionInput['spawnTerminal'], onEvent: AcpAgentSessionInput['onEvent']) {
    this.spawn = spawn
    this.onEvent = onEvent
  }

  create(params: acp.CreateTerminalRequest): acp.CreateTerminalResponse {
    const env = Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value]))
    const handle = this.spawn(params.command, params.args ?? [], params.cwd ?? process.cwd(), env)
    const terminalId = randomUUID()
    const terminal: ManagedTerminal = {
      handle,
      output: '',
      truncated: false,
      limit: params.outputByteLimit ?? 1_048_576,
      exit: null,
      drained: Promise.resolve(),
    }
    this.terminals.set(terminalId, terminal)
    this.onEvent('terminal.started', {
      terminalId,
      pid: handle.pid ?? null,
      command: params.command,
      args: params.args ?? [],
      cwd: params.cwd ?? process.cwd(),
      envNames: (params.env ?? []).map((entry) => entry.name),
    })
    terminal.drained = Promise.all([
      consumeTerminalStream(terminal, terminalId, 'stdout', handle.stdout, this.onEvent),
      consumeTerminalStream(terminal, terminalId, 'stderr', handle.stderr, this.onEvent),
    ]).then(
      () => undefined,
      (error: unknown) => {
        this.onEvent('terminal.output.error', {
          terminalId,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
    void handle.exited.then((exit): void => {
      terminal.exit = { exitCode: exit.code, signal: exit.signal }
      this.onEvent('terminal.exited', { terminalId, exitCode: exit.code, signal: exit.signal })
    })
    return { terminalId }
  }

  output(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
    const terminal = this.require(params.terminalId)
    return { output: terminal.output, truncated: terminal.truncated, exitStatus: terminal.exit }
  }

  async wait(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    const terminal = this.require(params.terminalId)
    const exit = await terminal.handle.exited
    await terminal.drained
    return { exitCode: exit.code, signal: exit.signal }
  }

  async kill(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> {
    await this.require(params.terminalId).handle.kill()
    return {}
  }

  async release(params: acp.ReleaseTerminalRequest): Promise<acp.ReleaseTerminalResponse> {
    const terminal = this.require(params.terminalId)
    if (terminal.exit === null) await terminal.handle.kill()
    await terminal.drained
    this.terminals.delete(params.terminalId)
    this.onEvent('terminal.released', { terminalId: params.terminalId })
    return {}
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.terminals.values(), (terminal) =>
        terminal.exit === null ? terminal.handle.kill().catch(() => undefined) : Promise.resolve(),
      ),
    )
    this.terminals.clear()
  }

  private require(terminalId: string): ManagedTerminal {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) throw new Error(`ACP terminal was not found: ${terminalId}`)
    return terminal
  }
}

function textFromUpdate(notification: acp.SessionNotification): string {
  const update = notification.update
  return update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? update.content.text : ''
}

async function consumeAgentStderr(
  stream: ReadableStream<Uint8Array>,
  onEvent: AcpAgentSessionInput['onEvent'],
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const item = await reader.read()
    if (item.done) {
      const text = decoder.decode()
      if (text) onEvent('agent.stderr', { text })
      return
    }
    const text = decoder.decode(item.value, { stream: true })
    if (text) onEvent('agent.stderr', { text })
  }
}

export async function runAcpAgentSession(input: AcpAgentSessionInput): Promise<AcpAgentSessionResult> {
  const terminalRegistry = new AcpTerminalRegistry(input.spawnTerminal, input.onEvent)
  const writable = new WritableStream<Uint8Array>({
    write: (chunk): Promise<void> => input.process.write(chunk),
    close: (): void => input.process.closeStdin(),
  })
  const stream = acp.ndJsonStream(writable, input.process.stdout)
  let text = ''
  void consumeAgentStderr(input.process.stderr, input.onEvent).catch((error: unknown) => {
    input.onEvent('agent.stderr.error', { error: error instanceof Error ? error.message : String(error) })
  })
  try {
    return await acp
      .client({ name: 'taskflow' })
      .onRequest(acp.methods.client.session.requestPermission, async (context) => {
        const kind = context.params.toolCall.kind ?? 'other'
        const selected = await input.requestPermission(kind, context.params.options, context.params)
        if (selected === null) return { outcome: { outcome: 'cancelled' } }
        return { outcome: { outcome: 'selected', optionId: selected } }
      })
      .onRequest(acp.methods.client.terminal.create, (context) => terminalRegistry.create(context.params))
      .onRequest(acp.methods.client.terminal.output, (context) => terminalRegistry.output(context.params))
      .onRequest(acp.methods.client.terminal.waitForExit, (context) => terminalRegistry.wait(context.params))
      .onRequest(acp.methods.client.terminal.kill, (context) => terminalRegistry.kill(context.params))
      .onRequest(acp.methods.client.terminal.release, (context) => terminalRegistry.release(context.params))
      .onNotification(acp.methods.client.session.update, (context) => {
        text += textFromUpdate(context.params)
        input.onEvent('agent.update', jsonValue(context.params))
      })
      .connectWith(stream, async (context): Promise<AcpAgentSessionResult> => {
        const initialized = await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { terminal: true },
          clientInfo: { name: 'taskflow', version: '1' },
        })
        const capabilities = normalizeAcpCapabilities(initialized.agentCapabilities ?? {})
        const mcpServers: acp.McpServer[] = input.mcpServers.map((server) => ({
          name: server.name,
          command: server.command,
          args: server.args,
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
        }))
        let sessionId: string
        if (input.sessionId) {
          if (capabilities.resumeSession) {
            await context.request(acp.methods.agent.session.resume, {
              sessionId: input.sessionId,
              cwd: input.cwd,
              mcpServers,
            })
          } else if (capabilities.loadSession) {
            await context.request(acp.methods.agent.session.load, {
              sessionId: input.sessionId,
              cwd: input.cwd,
              mcpServers,
            })
          } else {
            throw new Error('ACP agent does not support session resume or load')
          }
          sessionId = input.sessionId
        } else {
          const created = await context.request(acp.methods.agent.session.new, { cwd: input.cwd, mcpServers })
          sessionId = created.sessionId
        }
        input.onReady(sessionId, capabilities)
        const cancel = (): void => {
          void context.notify(acp.methods.agent.session.cancel, { sessionId })
        }
        input.signal?.addEventListener('abort', cancel, { once: true })
        if (input.signal?.aborted) cancel()
        const response = await context
          .request(acp.methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: 'text', text: input.prompt }],
          })
          .finally(() => input.signal?.removeEventListener('abort', cancel))
        return { sessionId, stopReason: response.stopReason, text }
      })
  } finally {
    await terminalRegistry.shutdown()
  }
}

export function selectPermissionOption(
  mode: AgentPermissionMode,
  toolKind: string,
  options: PermissionOption[],
): string | null {
  const reject = options.find((option) => option.kind === 'reject_once' || option.kind === 'reject_always')
  if (mode === 'deny' || toolKind === 'other') return reject?.optionId ?? null
  const allowOnce = options.find((option) => option.kind === 'allow_once')
  if (mode === 'workspace') return allowOnce?.optionId ?? reject?.optionId ?? null
  return null
}
