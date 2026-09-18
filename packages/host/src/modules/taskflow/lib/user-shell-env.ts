import { type ChildProcess, spawn } from 'node:child_process'
import { basename, delimiter } from 'node:path'

const SHELL_ENV_START_MARKER = '__PORTTA_FLOW_SHELL_ENV_START__'
const SHELL_ENV_END_MARKER = '__PORTTA_FLOW_SHELL_ENV_END__'
const SHELL_ENV_COMMAND = [
  `printf '%s\\n' ${SHELL_ENV_START_MARKER}`,
  'env',
  `printf '%s\\n' ${SHELL_ENV_END_MARKER}`,
].join('; ')
const DEFAULT_TIMEOUT_MS = 3_000
const FORCE_KILL_DELAY_MS = 1_000
const DEFAULT_REFRESH_TTL_MS = 10_000
const MAX_SHELL_OUTPUT_BYTES = 64 * 1024

export interface UserShellEnvSpawnArgs {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export interface UserShellEnvSpawnResult {
  error?: Error
  signal: NodeJS.Signals | null
  status: number | null
  stderr: string
  stdout: string
}

export type SpawnUserShellEnv = (args: UserShellEnvSpawnArgs) => Promise<UserShellEnvSpawnResult>

export interface ResolveUserShellPathOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  spawnUserShellEnv?: SpawnUserShellEnv
  timeoutMs?: number
}

export interface HostShellPathRefreshResult {
  changed: boolean
  path: string
}

export interface HostShellPathRefresher {
  refresh(): Promise<HostShellPathRefreshResult>
}

export interface CreateHostShellPathRefresherOptions extends ResolveUserShellPathOptions {
  now?: () => number
  refreshTtlMs?: number
}

export function resolveUserShellCommand(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (platform === 'win32') return null
  const configured = env.SHELL?.trim()
  if (configured) return configured
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

export function userShellArgSets(shell: string, command: string): string[][] {
  const name = basename(shell)
  if (name === 'sh' || name === 'dash') return [['-lc', command]]
  if (name === 'fish')
    return [
      ['-lc', command],
      ['-c', command],
    ]
  return [
    ['-ilc', command],
    ['-lc', command],
  ]
}

function pathFromShellOutput(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() === SHELL_ENV_START_MARKER)
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.trim() === SHELL_ENV_END_MARKER)
  if (end === -1) return null
  for (const line of lines.slice(start + 1, end)) {
    if (!line.startsWith('PATH=')) continue
    const path = line.slice('PATH='.length).trim()
    return path || null
  }
  return null
}

/**
 * Retain the launcher's PATH while adding paths learned from the user's shell.
 * A terminal may expose an agent CLI through an environment that its login
 * shell does not recreate (for example, an NVM or agent-host shim).
 */
function mergePaths(inheritedPath: string, shellPath: string): string {
  const entries = [...inheritedPath.split(delimiter), ...shellPath.split(delimiter)]
  const unique = new Set<string>()
  for (const entry of entries) {
    if (entry) unique.add(entry)
  }
  return [...unique].join(delimiter)
}

function defaultSpawnUserShellEnv(args: UserShellEnvSpawnArgs): Promise<UserShellEnvSpawnResult> {
  return new Promise<UserShellEnvSpawnResult>((resolveResult): void => {
    let child: ChildProcess | null = null
    let stdout = ''
    let stderr = ''
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let forceKill: ReturnType<typeof setTimeout> | undefined

    const clearTimers = (keepForceKill = false): void => {
      if (timeout) clearTimeout(timeout)
      if (!keepForceKill && forceKill) clearTimeout(forceKill)
      timeout = undefined
      if (!keepForceKill) forceKill = undefined
    }
    const settle = (result: UserShellEnvSpawnResult, keepForceKill = false): void => {
      if (settled) return
      settled = true
      clearTimers(keepForceKill)
      resolveResult(result)
    }
    const terminate = (): void => {
      if (settled) return
      child?.kill('SIGTERM')
      forceKill = setTimeout((): void => {
        child?.kill('SIGKILL')
      }, FORCE_KILL_DELAY_MS)
      forceKill.unref()
    }
    const rejectOversizedOutput = (): void => {
      if (settled) return
      terminate()
      settle(
        {
          error: new Error('Shell environment probe produced too much output'),
          signal: null,
          status: null,
          stderr,
          stdout,
        },
        true,
      )
    }

    try {
      child = spawn(args.command, args.args, { env: args.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      settle({
        error: error instanceof Error ? error : new Error(String(error)),
        signal: null,
        status: null,
        stderr,
        stdout,
      })
      return
    }

    timeout = setTimeout((): void => {
      terminate()
      settle(
        {
          error: new Error(`Shell environment probe timed out after ${args.timeoutMs}ms`),
          signal: 'SIGTERM',
          status: null,
          stderr,
          stdout,
        },
        true,
      )
    }, args.timeoutMs)
    timeout.unref()

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string): void => {
      stdout += chunk
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_SHELL_OUTPUT_BYTES) rejectOversizedOutput()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string): void => {
      stderr += chunk
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_SHELL_OUTPUT_BYTES) rejectOversizedOutput()
    })
    child.on('error', (error: Error): void => {
      settle({ error, signal: null, status: null, stderr, stdout })
    })
    child.on('close', (status: number | null, signal: NodeJS.Signals | null): void => {
      settle({ signal, status, stderr, stdout })
    })
  })
}

async function resolveWithPrevious(
  options: ResolveUserShellPathOptions,
  previous: string | null,
): Promise<string | null> {
  const env = options.env ?? process.env
  const shell = resolveUserShellCommand(env, options.platform ?? process.platform)
  if (!shell) return null
  const spawnUserShellEnv = options.spawnUserShellEnv ?? defaultSpawnUserShellEnv
  for (const [index, args] of userShellArgSets(shell, SHELL_ENV_COMMAND).entries()) {
    const result = await spawnUserShellEnv({
      command: shell,
      args,
      env,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    if (result.error || result.signal !== null || result.status !== 0) {
      if (index === 0 && previous) return previous
      continue
    }
    const path = pathFromShellOutput(result.stdout)
    if (path) return path
    if (index === 0 && previous) return previous
  }
  return null
}

export async function resolveUserShellPath(options: ResolveUserShellPathOptions = {}): Promise<string | null> {
  return resolveWithPrevious(options, null)
}

export function createUserShellPathResolver(options: ResolveUserShellPathOptions = {}): () => Promise<string | null> {
  let previous: string | null = null
  return async (): Promise<string | null> => {
    const path = await resolveWithPrevious(options, previous)
    if (path) previous = path
    return path
  }
}

export function createHostShellPathRefresher(
  options: CreateHostShellPathRefresherOptions = {},
): HostShellPathRefresher {
  const env = options.env ?? process.env
  const resolvePath = createUserShellPathResolver(options)
  const now = options.now ?? Date.now
  const ttlMs = options.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS
  let path = env.PATH ?? ''
  let expiresAt = 0
  let pending: Promise<HostShellPathRefreshResult> | null = null

  return {
    refresh(): Promise<HostShellPathRefreshResult> {
      if (pending) return pending
      if (expiresAt > now()) return Promise.resolve({ changed: false, path })
      pending = (async (): Promise<HostShellPathRefreshResult> => {
        const resolved = await resolvePath()
        const next = resolved ? mergePaths(path, resolved) : path
        const changed = next !== path
        path = next
        if (path) env.PATH = path
        expiresAt = now() + ttlMs
        return { changed, path }
      })()
      return pending.finally((): void => {
        pending = null
      })
    },
  }
}

const hostShellPathRefresher = createHostShellPathRefresher()

export function refreshHostShellPath(): Promise<HostShellPathRefreshResult> {
  return hostShellPathRefresher.refresh()
}
