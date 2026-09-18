// Taskflow's checks in `portta doctor`.
//
// Two questions: does the host daemon serve Taskflow to someone holding its
// token, and does this machine have the tools a worktree session needs. The
// tool list and how a tool is found are Taskflow's own (`init-deps`, the host
// tool resolver that looks past a non-interactive PATH), not a second copy.

import { createRequire } from 'node:module'
import { check, type DoctorCheck } from 'portta-core'
import { hostListen, resolveHostStateDir } from 'portta-host'
import { daemonOrigin, daemonToken, TASKFLOW_API_MOUNT } from '../commands/flow/daemon.ts'
import {
  INIT_DEPENDENCIES,
  type InitDependency,
  type InitDependencyStatus,
  inspectInitDependency,
} from '../commands/flow/init-deps.ts'
import type { GatewayContext } from '../context.js'

/** What a request to the daemon came back with: a status, or no answer at all. */
export type DaemonProbe = { reached: false } | { reached: true; health: boolean; module: number | null }

export interface TaskflowDoctorProbes {
  daemon: (origin: string, token: string | null) => Promise<DaemonProbe>
  tool: (dependency: InitDependency) => InitDependencyStatus
  devcontainerCli: () => string | null
}

const HERDR: InitDependency = {
  tool: 'herdr',
  args: ['--version'],
  required: false,
  hint: 'install herdr and set multiplexer: herdr in .portta/taskflow.local.yaml to use it instead of tmux',
}

async function probeDaemon(origin: string, token: string | null): Promise<DaemonProbe> {
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, { headers, signal: AbortSignal.timeout(2000) })
  try {
    const health = await get('/api/health')
    if (!token) return { reached: true, health: health.ok, module: null }
    const module = await get(`${TASKFLOW_API_MOUNT}/api/projects`, { authorization: `Bearer ${token}` })
    return { reached: true, health: health.ok, module: module.status }
  } catch {
    return { reached: false }
  }
}

function devcontainerCliVersion(): string | null {
  try {
    const require = createRequire(import.meta.url)
    return (require(require.resolve('@devcontainers/cli/package.json')) as { version?: string }).version ?? 'unknown'
  } catch {
    return null
  }
}

const defaultProbes: TaskflowDoctorProbes = {
  daemon: probeDaemon,
  tool: (dependency) => inspectInitDependency(dependency),
  devcontainerCli: devcontainerCliVersion,
}

export function daemonCheck(origin: string, token: string | null, probe: DaemonProbe): DoctorCheck {
  const title = 'Taskflow host daemon'
  if (!probe.reached)
    return check(
      'taskflow-daemon',
      'warn',
      title,
      `nothing answers at ${origin}`,
      'portta host serve --detach  (or portta host service install)',
    )
  if (token === null)
    return check(
      'taskflow-daemon',
      'warn',
      title,
      `the daemon at ${origin} has no token this CLI can read`,
      'run portta flow from the installation that started the daemon, or set PORTTA_HOST_STATE_DIR',
    )
  if (probe.module === 401)
    return check(
      'taskflow-daemon',
      'fail',
      title,
      `the daemon at ${origin} refuses this installation's token`,
      'restart the daemon from this installation: portta host service restart',
    )
  if (probe.module === 404)
    return check(
      'taskflow-daemon',
      'warn',
      title,
      `the daemon at ${origin} is older than this CLI and serves no Taskflow route`,
      'update portta on the host, then restart the daemon: portta host service restart',
    )
  if (probe.module !== null && probe.module >= 200 && probe.module < 300)
    return check('taskflow-daemon', 'pass', title, `serving Taskflow at ${origin}${TASKFLOW_API_MOUNT}`)
  return check(
    'taskflow-daemon',
    'warn',
    title,
    `the daemon at ${origin} answered ${probe.module ?? 'without a status'}`,
    'portta host service logs',
  )
}

export function toolCheck(status: InitDependencyStatus, required = status.required): DoctorCheck {
  const id = `taskflow-tool-${status.tool}`
  if (!status.found) return check(id, required ? 'fail' : 'info', status.tool, 'not found', status.hint)
  if (!status.probeOk)
    return check(id, 'warn', status.tool, `found, but \`${status.tool} ${status.args.join(' ')}\` failed`, status.hint)
  return check(id, 'pass', status.tool, 'available')
}

export async function taskflowDoctorChecks(
  context: Pick<GatewayContext, 'env' | 'root'>,
  probes: TaskflowDoctorProbes = defaultProbes,
): Promise<DoctorCheck[]> {
  const env = { ...context.env, PORTTA_HOST_STATE_DIR: resolveHostStateDir(context.root, context.env) }
  const listen = hostListen(env)
  const origin = daemonOrigin(listen.port, env)
  const token = daemonToken(env)
  const checks = [daemonCheck(origin, token, await probes.daemon(origin, token))]

  // A session runs in tmux or herdr; either one is enough.
  const statuses = INIT_DEPENDENCIES.map((dependency) => probes.tool(dependency))
  const herdr = probes.tool(HERDR)
  const multiplexerFound = herdr.found || statuses.some((status) => status.tool === 'tmux' && status.found)
  for (const status of statuses)
    checks.push(toolCheck(status, status.tool === 'tmux' ? !multiplexerFound : status.required))
  checks.push(toolCheck(herdr))

  const devcontainer = probes.devcontainerCli()
  checks.push(
    devcontainer === null
      ? check(
          'taskflow-tool-devcontainer',
          'info',
          'Dev Containers CLI',
          'not installed beside the CLI; Dev Container environments are unavailable',
          'reinstall @codions/portta',
        )
      : check('taskflow-tool-devcontainer', 'pass', 'Dev Containers CLI', `@devcontainers/cli ${devcontainer}`),
  )

  return checks.map((entry) => ({
    ...entry,
    category: entry.id === 'taskflow-daemon' ? 'infrastructure' : 'development',
  }))
}
