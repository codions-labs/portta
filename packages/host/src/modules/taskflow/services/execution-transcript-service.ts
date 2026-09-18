import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize } from 'node:path'
import {
  type ExecutionTranscriptResponse,
  type JsonValue,
  type TranscriptChunk,
  TranscriptChunkSchema,
} from 'portta-contracts/taskflow'
import type { ExecutionRecord, RunRecord } from 'portta-core/taskflow'
import { buildClaudeSessionFromText } from '../adapters/claude-cli.ts'
import type { RunStore } from '../adapters/run-store.ts'
import type { DiscoverableAgentKind, SessionDiscoveryGateway } from '../adapters/session-discovery.ts'
import { parseCodexSessionMessages } from './codex-session-log-service.ts'

export type TranscriptReadResult =
  | { ok: true; response: ExecutionTranscriptResponse }
  | { ok: false; reason: 'not_found' | 'unavailable' }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function transcriptPath(value: unknown, engineRunId: string): string | null {
  const candidate = record(value)?.transcriptPath
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return null
  const path = normalize(candidate)
  const agents = dirname(path)
  const run = dirname(agents)
  if (
    basename(agents) !== 'agents' ||
    basename(run) !== engineRunId ||
    basename(dirname(run)) !== 'runs' ||
    !basename(path).endsWith('.jsonl')
  )
    return null
  return path
}

function timestamp(value: string | null, fallback: string): number {
  const parsed = Date.parse(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : 0
}

interface DirectTranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  createdAt: string | null
  kind?: 'text' | 'toolUse' | 'toolResult' | 'thinking'
  toolName?: string
  toolCallId?: string
  command?: string
  status?: 'completed' | 'failed' | 'inProgress'
}

function directTranscriptChunk(message: DirectTranscriptMessage, fallback: string): TranscriptChunk | null {
  const t = timestamp(message.createdAt, fallback)
  const kind = message.kind ?? 'text'
  if (kind === 'thinking') return { t, kind: 'reasoning', text: message.text }
  if (kind === 'text') return message.role === 'assistant' ? { t, kind: 'text', text: message.text } : null
  if (kind === 'toolUse') {
    return {
      t,
      kind: 'tool',
      ...(message.toolCallId ? { id: message.toolCallId } : {}),
      name: message.toolName ?? 'tool',
      ...(message.command || message.text ? { input: message.command ?? message.text } : {}),
    }
  }
  if (kind === 'toolResult') {
    return {
      t,
      kind: 'tool-result',
      ...(message.toolCallId ? { id: message.toolCallId } : {}),
      ...(message.toolName ? { name: message.toolName } : {}),
      output: message.text,
      isError: message.status === 'failed',
    }
  }
  return null
}

function directHarness(execution: ExecutionRecord): DiscoverableAgentKind | null {
  return execution.harness === 'claude' || execution.harness === 'codex' ? execution.harness : null
}

export class ExecutionTranscriptService {
  private readonly store: RunStore
  private readonly sessionDiscovery?: SessionDiscoveryGateway
  constructor(store: RunStore, sessionDiscovery?: SessionDiscoveryGateway) {
    this.store = store
    this.sessionDiscovery = sessionDiscovery
  }

  async read(executionId: string, after = 0): Promise<TranscriptReadResult> {
    const execution = this.store.getExecution(executionId)
    if (execution === null) return { ok: false, reason: 'not_found' }
    const run = this.store.getRun(execution.runId)
    if (run?.mode === 'direct') return await this.readDirect(run, execution, after)
    if (run?.engineRunId === null || run?.engineRunId === undefined) return { ok: false, reason: 'unavailable' }
    const path = transcriptPath(execution.effectiveConfig, run.engineRunId)
    if (path === null) return { ok: false, reason: 'unavailable' }
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, reason: 'unavailable' }
      return { ok: true, response: { executionId, entries: [], nextCursor: 0 } }
    }
    const start = after <= bytes.length ? after : 0
    const entries: ExecutionTranscriptResponse['entries'] = []
    let cursor = start
    while (cursor < bytes.length) {
      const newline = bytes.indexOf(10, cursor)
      if (newline < 0) break
      const nextCursor = newline + 1
      const line = bytes.subarray(cursor, newline).toString('utf8').trim()
      cursor = nextCursor
      if (!line) continue
      try {
        const parsed = TranscriptChunkSchema.safeParse(JSON.parse(line))
        if (parsed.success) entries.push({ cursor, chunk: parsed.data })
      } catch {}
    }
    return { ok: true, response: { executionId, entries, nextCursor: cursor } }
  }

  private async readDirect(run: RunRecord, execution: ExecutionRecord, after: number): Promise<TranscriptReadResult> {
    const config = record(execution.effectiveConfig)
    if (config?.transport === 'acp') return this.readAcpDirect(run, execution, after)
    const harness = directHarness(execution)
    if (
      config?.transcriptSource !== 'provider_session' ||
      !harness ||
      !execution.sessionId ||
      !run.worktreePath ||
      !this.sessionDiscovery?.findSessionPath
    ) {
      return { ok: false, reason: 'unavailable' }
    }
    const path = await this.sessionDiscovery.findSessionPath(harness, run.worktreePath, execution.sessionId)
    if (!path) return { ok: false, reason: 'unavailable' }
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    const messages =
      harness === 'codex'
        ? parseCodexSessionMessages(text)
        : buildClaudeSessionFromText({ path, sessionId: execution.sessionId, text }).messages
    const chunks: TranscriptChunk[] = [
      {
        t: timestamp(execution.startedAt, run.createdAt),
        kind: 'meta',
        index: 0,
        label: execution.label,
        provider: execution.provider ?? harness,
        ...(execution.model ? { model: execution.model } : {}),
        prompt: typeof execution.input === 'string' ? execution.input : JSON.stringify(execution.input),
      },
      ...messages.flatMap((message) => {
        const chunk = directTranscriptChunk(message, run.createdAt)
        return chunk ? [chunk] : []
      }),
    ]
    const start = after <= chunks.length ? after : 0
    const entries = chunks.flatMap((chunk, index) => {
      const cursor = index + 1
      return cursor > start ? [{ cursor, chunk }] : []
    })
    return { ok: true, response: { executionId: execution.id, entries, nextCursor: chunks.length } }
  }

  private readAcpDirect(run: RunRecord, execution: ExecutionRecord, after: number): TranscriptReadResult {
    const chunks: TranscriptChunk[] = [
      {
        t: timestamp(execution.startedAt, run.createdAt),
        kind: 'meta',
        index: 0,
        label: execution.label,
        provider: execution.provider ?? execution.harness,
        ...(execution.model ? { model: execution.model } : {}),
        prompt: typeof execution.input === 'string' ? execution.input : JSON.stringify(execution.input),
      },
    ]
    for (const source of this.store.listEvents(run.id)) {
      if (source.executionId !== execution.id || source.type !== 'acp.agent.update') continue
      const data = record(record(source.payload)?.data)
      const event = record(data?.event)
      const update = record(event?.update)
      const content = record(update?.content)
      const t = Date.parse(source.timestamp)
      if (
        (update?.sessionUpdate === 'agent_message_chunk' || update?.sessionUpdate === 'agent_thought_chunk') &&
        content?.type === 'text' &&
        typeof content.text === 'string'
      ) {
        chunks.push({
          t: Number.isFinite(t) ? t : 0,
          kind: update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'text',
          text: content.text,
        })
      } else if (update?.sessionUpdate === 'tool_call' && typeof update.title === 'string') {
        chunks.push({
          t: Number.isFinite(t) ? t : 0,
          kind: 'tool',
          ...(typeof update.toolCallId === 'string' ? { id: update.toolCallId } : {}),
          name: update.title,
          ...(update.rawInput !== undefined ? { input: update.rawInput as JsonValue } : {}),
        })
      } else if (update?.sessionUpdate === 'tool_call_update' && update.status === 'completed') {
        chunks.push({
          t: Number.isFinite(t) ? t : 0,
          kind: 'tool-result',
          ...(typeof update.toolCallId === 'string' ? { id: update.toolCallId } : {}),
          ...(typeof update.title === 'string' ? { name: update.title } : {}),
          ...(typeof update.rawOutput === 'string' ? { output: update.rawOutput } : {}),
        })
      }
    }
    if (execution.status === 'completed' || execution.status === 'failed') {
      chunks.push({
        t: timestamp(execution.completedAt, run.updatedAt),
        kind: 'status',
        state: execution.status === 'completed' ? 'done' : 'failed',
        ...(execution.error ? { error: execution.error } : {}),
      })
    }
    const start = after <= chunks.length ? after : 0
    const entries = chunks.flatMap((chunk, index) => {
      const cursor = index + 1
      return cursor > start ? [{ cursor, chunk }] : []
    })
    return { ok: true, response: { executionId: execution.id, entries, nextCursor: chunks.length } }
  }
}
