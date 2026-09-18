import { open, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { isRecord } from '../lib/type-guards.ts'
import { encodeClaudeProjectDir, findClaudeSessionPath } from './claude-cli.ts'

/** Built-in agents whose on-disk session history we can discover. */
export type DiscoverableAgentKind = 'claude' | 'codex'
export type ProviderSessionActivity = 'running' | 'waiting_input'

export interface SessionDiscoveryGateway {
  /** Session ids for `cwd`, newest first. Claude reads `~/.claude/projects/<encoded>/`,
   *  Codex scans `~/.codex/sessions/**` and matches `session_meta.cwd`. */
  listSessionIds(agent: DiscoverableAgentKind, cwd: string): Promise<string[]>
  inspectSessionActivity?(
    agent: DiscoverableAgentKind,
    cwd: string,
    sessionId: string,
  ): Promise<ProviderSessionActivity | null>
  findSessionPath?(agent: DiscoverableAgentKind, cwd: string, sessionId: string): Promise<string | null>
}

interface StampedSession {
  sessionId: string
  mtimeMs: number
}

function home(): string {
  const value = process.env.HOME
  if (!value) throw new Error('HOME is required to resolve agent sessions')
  return value
}

function newestFirst(sessions: StampedSession[]): string[] {
  return sessions.sort((left, right) => right.mtimeMs - left.mtimeMs).map((entry) => entry.sessionId)
}

async function listClaudeSessionIds(cwd: string): Promise<string[]> {
  const dir = join(home(), '.claude', 'projects', encodeClaudeProjectDir(cwd))
  const names = await readdir(dir).catch((): string[] => [])
  const stamped = await Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map(async (name): Promise<StampedSession | null> => {
        const info = await stat(join(dir, name)).catch(() => null)
        return info ? { sessionId: basename(name, '.jsonl'), mtimeMs: info.mtimeMs } : null
      }),
  )
  return newestFirst(stamped.filter((entry): entry is StampedSession => entry !== null))
}

async function readFirstLine(path: string): Promise<string> {
  const file = await open(path, 'r')
  const chunks: Buffer[] = []
  const buffer = Buffer.alloc(16_384)

  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      const newline = buffer.subarray(0, bytesRead).indexOf(0x0a)
      chunks.push(Buffer.from(buffer.subarray(0, newline === -1 ? bytesRead : newline)))
      if (newline !== -1) break
    }
  } finally {
    await file.close()
  }

  return Buffer.concat(chunks).toString('utf8')
}

export async function readCodexSessionCwdId(path: string): Promise<{ id: string; cwd: string } | null> {
  try {
    const firstLine = await readFirstLine(path)
    if (!firstLine) return null
    const parsed: unknown = JSON.parse(firstLine)
    if (!isRecord(parsed) || parsed.type !== 'session_meta' || !isRecord(parsed.payload)) return null
    const { id, cwd } = parsed.payload
    return typeof id === 'string' && typeof cwd === 'string' ? { id, cwd } : null
  } catch {
    return null
  }
}

async function listCodexSessionIds(cwd: string): Promise<string[]> {
  const root = join(home(), '.codex', 'sessions')
  const relPaths = await readdir(root, { recursive: true }).catch((): string[] => [])
  const rollouts = relPaths.filter((rel) => {
    const name = basename(rel)
    return name.startsWith('rollout-') && name.endsWith('.jsonl')
  })
  const stamped = await Promise.all(
    rollouts.map(async (rel): Promise<StampedSession | null> => {
      const path = join(root, rel)
      const meta = await readCodexSessionCwdId(path)
      if (!meta || meta.cwd !== cwd) return null
      const info = await stat(path).catch(() => null)
      return info ? { sessionId: meta.id, mtimeMs: info.mtimeMs } : null
    }),
  )
  return newestFirst(stamped.filter((entry): entry is StampedSession => entry !== null))
}

async function findCodexSessionPath(sessionId: string, cwd: string): Promise<string | null> {
  const root = join(home(), '.codex', 'sessions')
  const relPaths = await readdir(root, { recursive: true }).catch((): string[] => [])
  for (const rel of relPaths) {
    if (!basename(rel).endsWith(`${sessionId}.jsonl`)) continue
    const path = join(root, rel)
    const meta = await readCodexSessionCwdId(path)
    if (meta?.id === sessionId && meta.cwd === cwd) return path
  }
  return null
}

function activityFromLine(agent: DiscoverableAgentKind, line: string): ProviderSessionActivity | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  if (agent === 'codex') {
    if (value.type !== 'event_msg' || !isRecord(value.payload)) return null
    if (value.payload.type === 'task_started') return 'running'
    if (value.payload.type === 'task_complete' || value.payload.type === 'turn_aborted') return 'waiting_input'
    return null
  }

  if (value.isSidechain === true || (value.type !== 'user' && value.type !== 'assistant')) return null
  if (!isRecord(value.message)) return null
  if (value.type === 'user' && value.message.role === 'user') return 'running'
  if (value.type !== 'assistant' || value.message.role !== 'assistant') return null
  return value.message.stop_reason === 'end_turn' ? 'waiting_input' : 'running'
}

export async function readProviderSessionActivity(
  agent: DiscoverableAgentKind,
  path: string,
): Promise<ProviderSessionActivity | null> {
  const file = await open(path, 'r').catch(() => null)
  if (!file) return null
  try {
    const size = (await file.stat()).size
    let position = size
    let suffix = Buffer.alloc(0)
    const buffer = Buffer.alloc(64 * 1024)
    while (position > 0) {
      const length = Math.min(buffer.length, position)
      position -= length
      const { bytesRead } = await file.read(buffer, 0, length, position)
      const combined = Buffer.concat([buffer.subarray(0, bytesRead), suffix])
      let lineEnd = combined.length
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue
        const activity = activityFromLine(agent, combined.subarray(index + 1, lineEnd).toString('utf8'))
        if (activity !== null) return activity
        lineEnd = index
      }
      suffix = Buffer.from(combined.subarray(0, lineEnd))
    }
    return activityFromLine(agent, suffix.toString('utf8'))
  } finally {
    await file.close()
  }
}

export class FileSessionDiscovery implements SessionDiscoveryGateway {
  async listSessionIds(agent: DiscoverableAgentKind, cwd: string): Promise<string[]> {
    return agent === 'claude' ? await listClaudeSessionIds(cwd) : await listCodexSessionIds(cwd)
  }

  async inspectSessionActivity(
    agent: DiscoverableAgentKind,
    cwd: string,
    sessionId: string,
  ): Promise<ProviderSessionActivity | null> {
    const path =
      agent === 'claude' ? await findClaudeSessionPath(sessionId, cwd) : await findCodexSessionPath(sessionId, cwd)
    return path ? await readProviderSessionActivity(agent, path) : null
  }

  async findSessionPath(agent: DiscoverableAgentKind, cwd: string, sessionId: string): Promise<string | null> {
    return agent === 'claude' ? await findClaudeSessionPath(sessionId, cwd) : await findCodexSessionPath(sessionId, cwd)
  }
}

/** Poll for a session id that appears in `cwd` but was not in `before`, returning the
 *  newest such id. Used to learn a freshly-forked session's id when it cannot be pinned
 *  (Codex). Returns null if nothing new shows up within the retry budget. */
export async function captureNewSessionId(
  discovery: SessionDiscoveryGateway,
  agent: DiscoverableAgentKind,
  cwd: string,
  before: string[],
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const beforeSet = new Set(before)
  const attempts = options.attempts ?? 20
  const delayMs = options.delayMs ?? 150
  const wait = options.sleep ?? ((ms: number): Promise<void> => sleep(ms))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const after = await discovery.listSessionIds(agent, cwd)
    const fresh = after.filter((id) => !beforeSet.has(id))
    const [first] = fresh
    if (first !== undefined) return first
    await wait(delayMs)
  }
  return null
}
