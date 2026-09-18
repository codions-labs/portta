/**
 * Docker container lifecycle for sandbox worktrees.
 *
 * Runs sandbox containers directly for managed docker worktrees.
 */

import { stat } from 'node:fs/promises'
import { RUNTIME_IDENTITY } from 'portta-core/taskflow/config'
import { log } from '../lib/log.ts'
import type { DockerProfileConfig, ServiceConfig } from './config.ts'
import { NodeProcessRunner, type ProcessExit } from './process-runner.ts'

const DOCKER_RUN_TIMEOUT_MS = 60_000
const processRunner = new NodeProcessRunner()

interface DockerProcessOutput {
  exit: ProcessExit
  stdout: string
  stderr: string
}

async function runDocker(args: string[], timeoutMs?: number): Promise<DockerProcessOutput> {
  const [command, ...commandArgs] = args
  if (!command) throw new Error('Docker command is required')
  const process = processRunner.start({ command, args: commandArgs, ...(timeoutMs ? { timeoutMs } : {}) })
  const [exit, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exit, stdout, stderr }
}

/** Check if a path (file or directory) exists on the host. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Sanitise a branch name into a Docker-safe segment.
 * Docker container names must match [a-zA-Z0-9][a-zA-Z0-9_.\-]*.
 * The product prefix and timestamp suffix are included in the 63-character cap.
 */
function sanitiseBranchForName(branch: string): string {
  const s = branch
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 63 - RUNTIME_IDENTITY.dockerContainerPrefix.length - 15)
  return s || 'x'
}

/** Container naming: {product}-{sanitised-branch}-{timestamp}. */
function containerName(branch: string): string {
  return `${RUNTIME_IDENTITY.dockerContainerPrefix}-${sanitiseBranchForName(branch)}-${Date.now()}`
}

/** Return true if s is a valid port number string (integer 1–65535). */
function isValidPort(s: string): boolean {
  const n = Number(s)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

/** Return true if s is a valid environment variable key. */
function isValidEnvKey(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
}

export interface LaunchContainerOpts {
  branch: string
  wtDir: string
  mainRepoDir: string
  sandboxConfig: DockerProfileConfig
  services: ServiceConfig[]
  runtimeEnv: Record<string, string>
  environmentId?: string
}

export interface DockerGateway {
  launchContainer(opts: LaunchContainerOpts): Promise<string>
  removeContainer(branch: string): Promise<void>
}

export class NodeDockerGateway implements DockerGateway {
  launchContainer(opts: LaunchContainerOpts): Promise<string> {
    return launchContainer(opts)
  }

  removeContainer(branch: string): Promise<void> {
    return removeContainer(branch)
  }
}

/**
 * Build the `docker run` argument list from the given options.
 *
 * This is a pure function — all I/O (path existence checks, env reads) must
 * be resolved by the caller and passed in as parameters.
 *
 * @param opts          - Launch options (branch, dirs, config, env).
 * @param existingPaths - Set of host paths confirmed to exist; used to decide
 *                        which credential mounts to include.
 * @param home          - Resolved home directory (e.g. process.env.HOME ?? "/root").
 * @param name          - Pre-generated container name.
 */
export function buildDockerRunArgs(
  opts: LaunchContainerOpts,
  existingPaths: Set<string>,
  home: string,
  name: string,
  sshAuthSock: string | undefined,
  hostUid: number,
  hostGid: number,
): string[] {
  const { wtDir, mainRepoDir, sandboxConfig, services, runtimeEnv } = opts

  const args: string[] = [
    'docker',
    'run',
    '-d',
    '--name',
    name,
    ...(opts.environmentId ? ['--label', `taskflow.environment.id=${opts.environmentId}`] : []),
    '-w',
    wtDir,
    '--add-host',
    'host.docker.internal:host-gateway',
    // Run as the host user so files created in mounted dirs (.git, worktree)
    // are owned by the right UID/GID instead of root.
    '--user',
    `${hostUid}:${hostGid}`,
  ]

  // Publish service ports bound to loopback only to avoid exposing dev services
  // on external interfaces. Skip invalid or duplicate port values.
  const seenPorts = new Set<string>()
  for (const svc of services) {
    const port = runtimeEnv[svc.portEnv]
    if (!port) continue
    if (!isValidPort(port)) {
      log.warn(`[docker] skipping invalid port for ${svc.portEnv}: ${JSON.stringify(port)}`)
      continue
    }
    if (seenPorts.has(port)) continue
    seenPorts.add(port)
    args.push('-p', `127.0.0.1:${port}:${port}`)
  }

  // Core env vars — defined first so passthrough cannot override them.
  const reservedKeys = new Set([
    'HOME',
    'TERM',
    'IS_SANDBOX',
    'SSH_AUTH_SOCK',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
    'GIT_CONFIG_KEY_1',
    'GIT_CONFIG_VALUE_1',
  ])
  args.push('-e', 'HOME=/root')
  args.push('-e', 'TERM=xterm-256color')
  args.push('-e', 'IS_SANDBOX=1')

  // Git safe.directory config so git works in mounted worktrees.
  args.push('-e', 'GIT_CONFIG_COUNT=2')
  args.push('-e', `GIT_CONFIG_KEY_0=safe.directory`)
  args.push('-e', `GIT_CONFIG_VALUE_0=${wtDir}`)
  args.push('-e', `GIT_CONFIG_KEY_1=safe.directory`)
  args.push('-e', `GIT_CONFIG_VALUE_1=${mainRepoDir}`)

  // Pass through host env vars listed in the docker profile.
  if (sandboxConfig.envPassthrough) {
    for (const key of sandboxConfig.envPassthrough) {
      if (!isValidEnvKey(key)) {
        log.warn(`[docker] skipping invalid envPassthrough key: ${JSON.stringify(key)}`)
        continue
      }
      if (reservedKeys.has(key)) continue
      const val = process.env[key]
      if (val !== undefined) {
        args.push('-e', `${key}=${val}`)
      }
    }
  }

  // Pass through generated runtime env; skip reserved keys and invalid key names.
  for (const [key, val] of Object.entries(runtimeEnv)) {
    if (!isValidEnvKey(key)) {
      log.warn(`[docker] skipping invalid runtime env key: ${JSON.stringify(key)}`)
      continue
    }
    if (reservedKeys.has(key)) continue
    args.push('-e', `${key}=${val}`)
  }

  // Core mounts.
  args.push('-v', `${wtDir}:${wtDir}`)
  args.push('-v', `${mainRepoDir}/.git:${mainRepoDir}/.git`)
  args.push('-v', `${mainRepoDir}:${mainRepoDir}:ro`)

  // Agent config mounts.
  args.push('-v', `${home}/.claude:/root/.claude`)
  args.push('-v', `${home}/.claude.json:/root/.claude.json`)
  args.push('-v', `${home}/.codex:/root/.codex`)

  // Compute which guest paths are already covered by configured mounts so
  // credential mounts for the same path can be skipped (explicit mounts win).
  const extraMountGuestPaths = new Set<string>()
  if (sandboxConfig.mounts) {
    for (const mount of sandboxConfig.mounts) {
      const hostPath = mount.hostPath.replace(/^~/, home)
      if (!hostPath.startsWith('/')) continue
      extraMountGuestPaths.add(mount.guestPath ?? hostPath)
    }
  }

  // Git/GitHub credential mounts (read-only, only if they exist on host and
  // are not overridden by a configured mount for the same guest path).
  const credentialMounts = [
    { hostPath: `${home}/.gitconfig`, guestPath: '/root/.gitconfig' },
    { hostPath: `${home}/.ssh`, guestPath: '/root/.ssh' },
    { hostPath: `${home}/.config/gh`, guestPath: '/root/.config/gh' },
  ]
  for (const { hostPath, guestPath } of credentialMounts) {
    if (extraMountGuestPaths.has(guestPath)) continue
    if (existingPaths.has(hostPath)) {
      args.push('-v', `${hostPath}:${guestPath}:ro`)
    }
  }

  // SSH agent forwarding — mount the socket so git+ssh works with
  // passphrase-protected keys and hardware tokens.  Use --mount instead
  // of -v because Docker's -v tries to mkdir socket paths and fails.
  if (sshAuthSock && existingPaths.has(sshAuthSock)) {
    args.push('--mount', `type=bind,source=${sshAuthSock},target=${sshAuthSock}`)
    args.push('-e', `SSH_AUTH_SOCK=${sshAuthSock}`)
  }

  // Additional mounts from config; require absolute host paths after ~ expansion.
  if (sandboxConfig.mounts) {
    for (const mount of sandboxConfig.mounts) {
      const hostPath = mount.hostPath.replace(/^~/, home)
      if (!hostPath.startsWith('/')) {
        log.warn(`[docker] skipping mount with non-absolute host path: ${JSON.stringify(hostPath)}`)
        continue
      }
      const guestPath = mount.guestPath ?? hostPath
      const suffix = mount.writable ? '' : ':ro'
      args.push('-v', `${hostPath}:${guestPath}${suffix}`)
    }
  }

  // Image + command.
  args.push(sandboxConfig.image, 'sleep', 'infinity')

  return args
}

/**
 * Launch a sandbox container for a worktree. Returns the container name.
 * If a container for this branch is already running, returns its name without launching a second one.
 */
export async function launchContainer(opts: LaunchContainerOpts): Promise<string> {
  const { branch } = opts

  // Idempotency: reuse an already-running container for this branch.
  const existing = await findContainer(branch)
  if (existing) {
    log.info(`[docker] reusing existing container ${existing} for branch ${branch}`)
    return existing
  }

  if (!opts.sandboxConfig.image) {
    throw new Error('sandboxConfig.image is required but was empty')
  }

  const name = containerName(branch)
  const home = process.env.HOME ?? '/root'

  // Resolve which credential paths exist on the host before building args.
  // Only forward SSH_AUTH_SOCK if the socket is world-accessible so the
  // Docker daemon (separate process) can bind-mount it.
  let sshAuthSock = process.env.SSH_AUTH_SOCK
  if (sshAuthSock) {
    try {
      const st = await stat(sshAuthSock)
      if (!st.isSocket() || (st.mode & 0o007) === 0) {
        log.debug(`[docker] skipping SSH_AUTH_SOCK (not world-accessible): ${sshAuthSock}`)
        sshAuthSock = undefined
      }
    } catch {
      sshAuthSock = undefined
    }
  }
  const credentialHostPaths = [
    `${home}/.gitconfig`,
    `${home}/.ssh`,
    `${home}/.config/gh`,
    ...(sshAuthSock ? [sshAuthSock] : []),
  ]
  const existingPaths = new Set<string>()
  await Promise.all(
    credentialHostPaths.map(async (p) => {
      if (await pathExists(p)) existingPaths.add(p)
    }),
  )

  if (!process.getuid || !process.getgid) {
    throw new Error('Docker sandbox requires a POSIX host with user and group IDs')
  }
  const args = buildDockerRunArgs(opts, existingPaths, home, name, sshAuthSock, process.getuid(), process.getgid())

  log.info(`[docker] launching container: ${name}`)
  const result = await runDocker(args, DOCKER_RUN_TIMEOUT_MS)

  if (result.exit.timedOut) {
    await runDocker(['docker', 'rm', '-f', name])
    throw new Error(`docker run timed out after ${DOCKER_RUN_TIMEOUT_MS / 1000}s`)
  }

  if (result.exit.code !== 0) {
    // Clean up any stopped container docker may have left behind.
    await runDocker(['docker', 'rm', '-f', name])
    throw new Error(`docker run failed (exit ${result.exit.code}): ${result.stderr}`)
  }

  log.info(`[docker] container ${name} ready (id=${result.stdout.trim().slice(0, 12)})`)

  return name
}

/**
 * Find the most-recently-started running container for a branch.
 * Returns the container name, or null if none is running.
 * Throws if the Docker daemon cannot be reached.
 */
export async function findContainer(branch: string): Promise<string | null> {
  const sanitised = sanitiseBranchForName(branch)
  const prefix = `${RUNTIME_IDENTITY.dockerContainerPrefix}-${sanitised}-`
  const result = await runDocker(['docker', 'ps', '--filter', `name=${prefix}`, '--format', '{{.Names}}'])

  if (result.exit.code !== 0) {
    throw new Error(`docker ps failed (exit ${result.exit.code}): ${result.stderr}`)
  }

  // Filter to exact prefix matches: the part after the prefix must be only
  // the numeric timestamp. This prevents "main" from matching "main-v2" containers.
  const names = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)))

  // docker ps lists containers newest-first; return the first match.
  return names.at(0) ?? null
}

/**
 * Remove all containers (running or stopped) for a branch.
 * Individual removal errors are logged but do not abort remaining removals.
 */
export async function removeContainer(branch: string): Promise<void> {
  const sanitised = sanitiseBranchForName(branch)
  const prefix = `${RUNTIME_IDENTITY.dockerContainerPrefix}-${sanitised}-`
  const listResult = await runDocker(['docker', 'ps', '-a', '--filter', `name=${prefix}`, '--format', '{{.Names}}'])

  if (listResult.exit.code !== 0) {
    log.error(`[docker] removeContainer: docker ps failed for ${branch}: ${listResult.stderr}`)
    return
  }

  const names = listResult.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)))

  await Promise.all(
    names.map(async (cname) => {
      log.info(`[docker] removing container: ${cname}`)
      const result = await runDocker(['docker', 'rm', '-f', cname])
      if (result.exit.code !== 0) {
        log.error(`[docker] failed to remove container ${cname}: ${result.stderr}`)
      }
    }),
  )
}
