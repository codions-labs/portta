import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ArchivedWorktreeEntry,
  CiCheck,
  ClaudeWorktreeConversationMeta,
  CodexWorktreeConversationMeta,
  ControlEnvMap,
  OpenSessionsState,
  PrComment,
  PrEntry,
  WorktreeArchiveState,
  WorktreeConversationMeta,
  WorktreeMeta,
  WorktreeStoragePaths,
  WorktreeTab,
} from 'portta-core/taskflow'
import {
  conversationSessionId,
  OPEN_SESSIONS_STATE_VERSION,
  ROOT_TAB_ID,
  WORKTREE_ARCHIVE_STATE_VERSION,
} from 'portta-core/taskflow'
import { ENV_NAMES } from 'portta-core/taskflow/config'
import { gitRuntimePaths } from 'portta-core/taskflow/paths'
import { isRecord } from '../lib/type-guards.ts'

const SAFE_ENV_VALUE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/
const DOTENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)/

function stringifyAllocatedPorts(ports: Record<string, number>): Record<string, string> {
  const entries = Object.entries(ports).map(([key, value]) => [key, String(value)])
  return Object.fromEntries(entries)
}

function quoteEnvValue(value: string): string {
  if (value.length > 0 && SAFE_ENV_VALUE_RE.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function parseDotenv(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('#')) continue
    const match = DOTENV_LINE_RE.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (key === undefined || rawValue === undefined) continue
    let value = rawValue
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.trimEnd()
    }
    env[key] = value
  }
  return env
}

export async function loadDotenvLocal(worktreePath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(join(worktreePath, '.env.local'), 'utf8')
    return parseDotenv(content)
  } catch {
    return {}
  }
}

export function getWorktreeStoragePaths(gitDir: string): WorktreeStoragePaths {
  const paths = gitRuntimePaths(gitDir)
  return {
    gitDir,
    taskflowDir: paths.root,
    metaPath: paths.meta,
    runtimeEnvPath: paths.runtimeEnv,
    controlEnvPath: paths.controlEnv,
    prsPath: paths.pullRequests,
  }
}

export function getProjectArchiveStatePath(gitDir: string): string {
  return gitRuntimePaths(gitDir).archiveState
}

export function getProjectOpenSessionsStatePath(gitDir: string): string {
  return gitRuntimePaths(gitDir).openSessionsState
}

export async function ensureWorktreeStorageDirs(gitDir: string): Promise<WorktreeStoragePaths> {
  const paths = getWorktreeStoragePaths(gitDir)
  await mkdir(paths.taskflowDir, { recursive: true })
  return paths
}

export async function readWorktreeMeta(gitDir: string): Promise<WorktreeMeta | null> {
  const { metaPath } = getWorktreeStoragePaths(gitDir)
  try {
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as WorktreeMeta
    return normalizeWorktreeMeta(raw)
  } catch {
    return null
  }
}

export async function writeWorktreeMeta(gitDir: string, meta: WorktreeMeta): Promise<void> {
  const { metaPath } = await ensureWorktreeStorageDirs(gitDir)
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`)
}

function isArchivedWorktreeEntry(raw: unknown): raw is ArchivedWorktreeEntry {
  return isRecord(raw) && typeof raw.path === 'string' && typeof raw.archivedAt === 'string'
}

function emptyWorktreeArchiveState(): WorktreeArchiveState {
  return {
    schemaVersion: WORKTREE_ARCHIVE_STATE_VERSION,
    entries: [],
  }
}

function isWorktreeArchiveState(raw: unknown): raw is WorktreeArchiveState {
  return (
    isRecord(raw) &&
    typeof raw.schemaVersion === 'number' &&
    Array.isArray(raw.entries) &&
    raw.entries.every((entry) => isArchivedWorktreeEntry(entry))
  )
}

export async function readWorktreeArchiveState(gitDir: string): Promise<WorktreeArchiveState> {
  const archivePath = getProjectArchiveStatePath(gitDir)
  try {
    const raw: unknown = JSON.parse(await readFile(archivePath, 'utf8'))
    return isWorktreeArchiveState(raw)
      ? {
          schemaVersion: raw.schemaVersion,
          entries: raw.entries.map((entry) => ({ ...entry })),
        }
      : emptyWorktreeArchiveState()
  } catch {
    return emptyWorktreeArchiveState()
  }
}

export async function writeWorktreeArchiveState(gitDir: string, state: WorktreeArchiveState): Promise<void> {
  const archivePath = getProjectArchiveStatePath(gitDir)
  await ensureWorktreeStorageDirs(gitDir)
  await writeFile(archivePath, `${JSON.stringify(state, null, 2)}\n`)
}

function emptyOpenSessionsState(): OpenSessionsState {
  return {
    schemaVersion: OPEN_SESSIONS_STATE_VERSION,
    savedAt: '',
    branches: [],
  }
}

function isOpenSessionsState(raw: unknown): raw is OpenSessionsState {
  return (
    isRecord(raw) &&
    typeof raw.schemaVersion === 'number' &&
    typeof raw.savedAt === 'string' &&
    Array.isArray(raw.branches) &&
    raw.branches.every((branch) => typeof branch === 'string')
  )
}

export async function readOpenSessionsState(gitDir: string): Promise<OpenSessionsState> {
  const statePath = getProjectOpenSessionsStatePath(gitDir)
  try {
    const raw: unknown = JSON.parse(await readFile(statePath, 'utf8'))
    return isOpenSessionsState(raw)
      ? {
          schemaVersion: raw.schemaVersion,
          savedAt: raw.savedAt,
          branches: [...raw.branches],
        }
      : emptyOpenSessionsState()
  } catch {
    return emptyOpenSessionsState()
  }
}

export async function writeOpenSessionsState(gitDir: string, state: OpenSessionsState): Promise<void> {
  const statePath = getProjectOpenSessionsStatePath(gitDir)
  await ensureWorktreeStorageDirs(gitDir)
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

export function buildRuntimeEnvMap(
  meta: WorktreeMeta,
  extraEnv: Record<string, string> = {},
  dotenvValues: Record<string, string> = {},
): Record<string, string> {
  return {
    ...dotenvValues,
    ...meta.startupEnvValues,
    ...stringifyAllocatedPorts(meta.allocatedPorts),
    ...extraEnv,
    [ENV_NAMES.worktreeId]: meta.worktreeId,
    [ENV_NAMES.branch]: meta.branch,
    [ENV_NAMES.profile]: meta.profile,
    [ENV_NAMES.agent]: meta.agent,
    [ENV_NAMES.runtime]: meta.runtime,
  }
}

export function buildControlEnvMap(input: {
  controlUrl: string
  controlToken: string
  worktreeId: string
  branch: string
}): ControlEnvMap {
  return {
    [ENV_NAMES.controlUrl]: input.controlUrl,
    [ENV_NAMES.controlToken]: input.controlToken,
    [ENV_NAMES.worktreeId]: input.worktreeId,
    [ENV_NAMES.branch]: input.branch,
  }
}

export function renderEnvFile(env: Record<string, string>): string {
  const lines = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
  return `${lines.join('\n')}\n`
}

export async function writeRuntimeEnv(gitDir: string, env: Record<string, string>): Promise<void> {
  const { runtimeEnvPath } = await ensureWorktreeStorageDirs(gitDir)
  await writeFile(runtimeEnvPath, renderEnvFile(env))
}

export async function writeControlEnv(gitDir: string, env: ControlEnvMap): Promise<void> {
  const { controlEnvPath } = await ensureWorktreeStorageDirs(gitDir)
  await writeFile(controlEnvPath, renderEnvFile(env))
}

function normalizeConversationMeta(
  raw: WorktreeConversationMeta | null | undefined,
): WorktreeConversationMeta | null | undefined {
  if (!raw) return raw

  if (raw.provider === 'codexAppServer') {
    if (!raw.conversationId || !raw.threadId) return undefined
    const normalized: CodexWorktreeConversationMeta = {
      provider: 'codexAppServer',
      conversationId: raw.conversationId,
      threadId: raw.threadId,
      cwd: raw.cwd,
      lastSeenAt: raw.lastSeenAt,
    }
    return normalized
  }

  if (!raw.conversationId || !raw.sessionId) return undefined
  const normalized: ClaudeWorktreeConversationMeta = {
    provider: 'claudeCode',
    conversationId: raw.conversationId,
    sessionId: raw.sessionId,
    cwd: raw.cwd,
    lastSeenAt: raw.lastSeenAt,
  }
  return normalized
}

function normalizeOptionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/** Give a meta without tabs its single root tab, so every worktree has one.
 *  Returns null when the meta already carries tabs so normalization can no-op. */
function backfillTabs(meta: WorktreeMeta): Pick<WorktreeMeta, 'tabs' | 'activeTabId' | 'forkCounter'> | null {
  if (meta.tabs && meta.tabs.length > 0) return null
  const rootTab: WorktreeTab = {
    tabId: ROOT_TAB_ID,
    kind: 'root',
    label: 'Root',
    seq: null,
    sessionId: conversationSessionId(meta.conversation),
    createdAt: meta.createdAt,
  }
  return {
    tabs: [rootTab],
    activeTabId: ROOT_TAB_ID,
    forkCounter: meta.forkCounter ?? 0,
  }
}

function normalizeWorktreeMeta(meta: WorktreeMeta): WorktreeMeta {
  const conversation = normalizeConversationMeta(meta.conversation)
  const normalizedLabel = normalizeOptionalString(meta.label)
  const tabBackfill = backfillTabs(meta)
  const interfaceMode = meta.interfaceMode === 'web_chat' ? 'web_chat' : 'terminal'
  if (
    conversation === meta.conversation &&
    normalizedLabel === meta.label &&
    tabBackfill === null &&
    meta.interfaceMode === interfaceMode
  ) {
    return meta
  }

  const rest: WorktreeMeta = { ...meta }
  delete rest.label
  delete rest.conversation
  return {
    ...rest,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
    ...(conversation !== undefined ? { conversation } : {}),
    interfaceMode,
    ...(tabBackfill ?? {}),
  }
}

function isPrComment(raw: unknown): raw is PrComment {
  if (!isRecord(raw)) return false
  return (
    (raw.type === 'comment' || raw.type === 'inline') &&
    typeof raw.author === 'string' &&
    typeof raw.body === 'string' &&
    typeof raw.createdAt === 'string' &&
    (raw.path === undefined || typeof raw.path === 'string') &&
    (raw.line === undefined || raw.line === null || typeof raw.line === 'number') &&
    (raw.diffHunk === undefined || typeof raw.diffHunk === 'string') &&
    (raw.isReply === undefined || typeof raw.isReply === 'boolean')
  )
}

function isCiCheck(raw: unknown): raw is CiCheck {
  if (!isRecord(raw)) return false
  return (
    typeof raw.name === 'string' &&
    (raw.status === 'pending' || raw.status === 'success' || raw.status === 'failed' || raw.status === 'skipped') &&
    (raw.url === null || typeof raw.url === 'string') &&
    (raw.runId === null || typeof raw.runId === 'number')
  )
}

/** `isDraft` is absent in entries written before draft tracking existed; the read
 *  path defaults it to false rather than discarding the stored PR. */
function isPrEntry(raw: unknown): raw is Omit<PrEntry, 'isDraft'> & { isDraft?: boolean } {
  if (!isRecord(raw)) return false
  return (
    typeof raw.repo === 'string' &&
    typeof raw.number === 'number' &&
    (raw.state === 'open' || raw.state === 'closed' || raw.state === 'merged') &&
    (raw.isDraft === undefined || typeof raw.isDraft === 'boolean') &&
    typeof raw.url === 'string' &&
    typeof raw.updatedAt === 'string' &&
    (raw.ciStatus === 'none' ||
      raw.ciStatus === 'pending' ||
      raw.ciStatus === 'success' ||
      raw.ciStatus === 'failed') &&
    Array.isArray(raw.ciChecks) &&
    raw.ciChecks.every((check) => isCiCheck(check)) &&
    Array.isArray(raw.comments) &&
    raw.comments.every((comment) => isPrComment(comment))
  )
}

export async function readWorktreePrs(gitDir: string): Promise<PrEntry[]> {
  const { prsPath } = getWorktreeStoragePaths(gitDir)
  try {
    const raw: unknown = JSON.parse(await readFile(prsPath, 'utf8'))
    if (!Array.isArray(raw) || !raw.every((entry) => isPrEntry(entry))) return []
    return raw.map((entry) => ({ ...entry, isDraft: entry.isDraft ?? false }))
  } catch {
    return []
  }
}

export async function writeWorktreePrs(gitDir: string, prs: PrEntry[]): Promise<void> {
  const { prsPath } = await ensureWorktreeStorageDirs(gitDir)
  await writeFile(prsPath, `${JSON.stringify(prs, null, 2)}\n`)
}
