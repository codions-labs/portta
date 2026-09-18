import { spawnSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { resolveUserShellCommand, userShellArgSets } from './user-shell-env.ts'

const LOGIN_WHICH_START_MARKER = '__PORTTA_FLOW_WHICH_START__'
const LOGIN_WHICH_END_MARKER = '__PORTTA_FLOW_WHICH_END__'
const LOGIN_WHICH_TIMEOUT_MS = 3_000
const NPM_PREFIX_TIMEOUT_MS = 3_000
const SAFE_TOOL_NAME = /^[A-Za-z0-9._+-]+$/

const TOOL_ENV_OVERRIDES: Record<string, string> = {
  codex: 'CODEX_BIN',
  opencode: 'OPENCODE_BIN',
  pi: 'PI_BIN',
}

export interface HostToolResolveOptions {
  env?: NodeJS.ProcessEnv
  execPath?: string
  isExecutable?: (candidate: string) => boolean
  lookupLoginShellCommand?: (tool: string) => string | null
  npmGlobalBin?: string | null
  platform?: NodeJS.Platform
}

export type HostToolResolver = (tool: string) => string | null

function defaultIsExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function firstExecutable(candidates: readonly string[], isExecutable: (candidate: string) => boolean): string | null {
  return candidates.find((candidate) => candidate.length > 0 && isExecutable(candidate)) ?? null
}

function pathCandidates(tool: string, pathEnv: string | undefined): string[] {
  if (!pathEnv) return []
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => join(entry, tool))
}

export function wellKnownBinDirectories(input: {
  env: NodeJS.ProcessEnv
  execPath: string
  npmGlobalBin?: string | null
  platform: NodeJS.Platform
}): string[] {
  const directories: string[] = []
  const home = input.env.HOME?.trim()
  if (home) {
    directories.push(
      join(home, '.local', 'bin'),
      join(home, '.cargo', 'bin'),
      join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, '.asdf', 'shims'),
      join(home, '.local', 'share', 'mise', 'shims'),
      join(home, '.npm-global', 'bin'),
    )
  }
  directories.push(dirname(input.execPath))
  if (input.npmGlobalBin) directories.push(input.npmGlobalBin)
  directories.push('/opt/homebrew/bin', '/usr/local/bin')
  if (input.platform === 'linux') directories.push('/home/linuxbrew/.linuxbrew/bin')
  return directories
}

export function wellKnownToolPaths(tool: string, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME?.trim()
  if (tool === 'claude' && home) return [join(home, '.claude', 'local', 'claude')]
  return []
}

function loginWhichCommand(tool: string): string {
  return [
    `printf '%s\\n' ${LOGIN_WHICH_START_MARKER}`,
    `command -v -- ${tool}`,
    `printf '%s\\n' ${LOGIN_WHICH_END_MARKER}`,
  ].join('; ')
}

function pathFromWhichOutput(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() === LOGIN_WHICH_START_MARKER)
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.trim() === LOGIN_WHICH_END_MARKER)
  if (end === -1) return null
  for (const line of lines.slice(start + 1, end)) {
    const candidate = line.trim()
    if (candidate) return candidate
  }
  return null
}

export function probeLoginShellWhich(
  tool: string,
  options: Pick<HostToolResolveOptions, 'env' | 'platform'> = {},
): string | null {
  if (!SAFE_TOOL_NAME.test(tool)) return null
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const shell = resolveUserShellCommand(env, platform)
  if (!shell) return null
  for (const args of userShellArgSets(shell, loginWhichCommand(tool))) {
    const result = spawnSync(shell, args, {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: LOGIN_WHICH_TIMEOUT_MS,
    })
    if (result.error || result.status !== 0) continue
    const candidate = pathFromWhichOutput(result.stdout ?? '')
    if (candidate && (isAbsolute(candidate) || candidate.includes('/'))) return candidate
  }
  return null
}

function resolveNpmGlobalBin(input: {
  env: NodeJS.ProcessEnv
  execPath: string
  isExecutable: (candidate: string) => boolean
  platform: NodeJS.Platform
}): string | null {
  const npm =
    firstExecutable(pathCandidates('npm', input.env.PATH), input.isExecutable) ??
    firstExecutable(
      wellKnownBinDirectories({
        env: input.env,
        execPath: input.execPath,
        platform: input.platform,
      }).map((directory) => join(directory, 'npm')),
      input.isExecutable,
    )
  if (!npm) return null
  const result = spawnSync(npm, ['prefix', '-g'], {
    env: input.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: NPM_PREFIX_TIMEOUT_MS,
  })
  if (result.error || result.status !== 0) return null
  const prefix = (result.stdout ?? '').trim().split(/\r?\n/u)[0]?.trim()
  return prefix ? join(prefix, 'bin') : null
}

export function createHostToolResolver(options: HostToolResolveOptions = {}): HostToolResolver {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath
  const isExecutable = options.isExecutable ?? defaultIsExecutableFile
  const lookupLoginShellCommand = options.lookupLoginShellCommand
  const npmGlobalBinProvided = options.npmGlobalBin !== undefined
  let npmGlobalBin = options.npmGlobalBin

  return (tool: string): string | null => {
    const name = tool.trim()
    if (!name) return null

    if (isAbsolute(name) || name.includes('/')) {
      return isExecutable(name) ? name : null
    }

    const overrideName = TOOL_ENV_OVERRIDES[name]
    if (overrideName) {
      const override = env[overrideName]?.trim()
      if (override) return isExecutable(override) ? override : null
    }

    const onPath = firstExecutable(pathCandidates(name, env.PATH), isExecutable)
    if (onPath) return onPath

    const loginPath = lookupLoginShellCommand?.(name)
    if (loginPath && isExecutable(loginPath)) return loginPath

    if (!npmGlobalBinProvided && npmGlobalBin === undefined) {
      npmGlobalBin = resolveNpmGlobalBin({ env, execPath, isExecutable, platform })
    }

    const wellKnown = wellKnownBinDirectories({ env, execPath, npmGlobalBin, platform }).map((directory) =>
      join(directory, name),
    )
    const wellKnownHit = firstExecutable(wellKnown, isExecutable)
    if (wellKnownHit) return wellKnownHit

    return firstExecutable(wellKnownToolPaths(name, env), isExecutable)
  }
}

const loginWhichCache = new Map<string, string | null>()
let defaultResolver: HostToolResolver | null = null
let thoroughResolver: HostToolResolver | null = null

function defaultLookupLoginShellCommand(tool: string): string | null {
  if (loginWhichCache.has(tool)) return loginWhichCache.get(tool) ?? null
  const found = probeLoginShellWhich(tool)
  loginWhichCache.set(tool, found)
  return found
}

function defaultHostToolResolver(): HostToolResolver {
  defaultResolver ??= createHostToolResolver()
  return defaultResolver
}

export function resolveHostToolThoroughly(tool: string, options?: HostToolResolveOptions): string | null {
  if (options) {
    return resolveHostTool(tool, {
      ...options,
      lookupLoginShellCommand: options.lookupLoginShellCommand ?? defaultLookupLoginShellCommand,
    })
  }
  thoroughResolver ??= createHostToolResolver({ lookupLoginShellCommand: defaultLookupLoginShellCommand })
  return thoroughResolver(tool)
}

export function resolveHostTool(tool: string, options?: HostToolResolveOptions): string | null {
  if (options) {
    return createHostToolResolver({
      ...options,
      lookupLoginShellCommand:
        options.lookupLoginShellCommand ?? ((name: string): string | null => probeLoginShellWhich(name, options)),
    })(tool)
  }
  return defaultHostToolResolver()(tool)
}

export function hostToolInvocation(tool: string, options?: HostToolResolveOptions): string {
  const resolved = resolveHostTool(tool, options) ?? tool
  return /[\s'"\\]/.test(resolved) ? `'${resolved.replaceAll("'", "'\\''")}'` : resolved
}

export function resolveWorkerBins(env: NodeJS.ProcessEnv = process.env): {
  codexBin?: string
  opencodeBin?: string
  pathToClaudeCodeExecutable?: string
  piBin?: string
} {
  const resolve = (name: string, override?: string): string | undefined => {
    const explicit = override?.trim()
    if (explicit) return resolveHostTool(explicit, { env }) ?? explicit
    return resolveHostTool(name, { env }) ?? undefined
  }
  return {
    codexBin: resolve('codex', env.CODEX_BIN),
    opencodeBin: resolve('opencode', env.OPENCODE_BIN),
    pathToClaudeCodeExecutable: resolve('claude'),
    piBin: resolve('pi', env.PI_BIN),
  }
}
