import { existsSync, readFileSync } from 'node:fs'
import { type ApiClient, createApi } from 'portta-contracts/taskflow'
import { ENV_NAMES } from 'portta-core/taskflow/config'
import { globalConfigDir } from 'portta-core/taskflow/paths'
import { hostStateDir, hostTokenFile } from 'portta-host'
import { findGatewayRoot } from '../../context.ts'

// Where the flow commands find the Portta host daemon, and the token it wants.
//
// The daemon serves Taskflow at `/api/modules/taskflow` and its sockets at
// `/ws/modules/taskflow`, behind the Bearer token in its state directory. Every
// command that talks to it builds its URLs and headers here, so the daemon's
// address, mount and credential are decided once.

export const TASKFLOW_API_MOUNT = '/api/modules/taskflow'
export const TASKFLOW_SOCKET_MOUNT = '/ws/modules/taskflow'

type Env = Readonly<Record<string, string | undefined>>

/** The daemon's state directory: `PORTTA_HOST_STATE_DIR`, else `state/host` under
 *  the installation `portta host serve` would start from. */
export function flowStateDir(env: Env = process.env): string {
  const configured = env[ENV_NAMES.hostStateDir]?.trim()
  if (configured) return configured
  return hostStateDir(findGatewayRoot() ?? globalConfigDir({ env: { ...env } }))
}

/** `http://<PORTTA_HOST_BIND>:<port>`, reaching a wildcard bind on loopback. */
export function daemonOrigin(port: number, env: Env = process.env): string {
  const bind = env[ENV_NAMES.host]?.trim() || '127.0.0.1'
  const host = bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`
}

/** Where the module's global routes are, e.g. `${base}/api/projects`. */
export function daemonBaseUrl(port: number, env: Env = process.env): string {
  return `${daemonOrigin(port, env)}${TASKFLOW_API_MOUNT}`
}

/** The daemon's token, read, never created: a missing file means no daemon has started here.
 *  A process an agent hook started carries it as the control token instead. */
export function daemonToken(env: Env = process.env): string | null {
  const file = hostTokenFile(flowStateDir(env))
  if (existsSync(file)) {
    try {
      const token = readFileSync(file, 'utf8').trim()
      if (token) return token
    } catch {
      // Unreadable: fall through to the environment.
    }
  }
  return env[ENV_NAMES.controlToken]?.trim() || null
}

export function daemonHeaders(env: Env = process.env): Record<string, string> {
  const token = daemonToken(env)
  return token ? { authorization: `Bearer ${token}` } : {}
}

/** The Taskflow API client for `baseUrl`, carrying the daemon's token. */
export function flowApi(baseUrl: string): ApiClient {
  return createApi(baseUrl, { baseHeaders: daemonHeaders() })
}

/** A socket path below a Project's HTTP base, as the daemon serves it:
 *  `http://h:p/api/modules/taskflow/<prefix>` + `/ws/…` → `ws://h:p/ws/modules/taskflow/<prefix>/ws/…`. */
export function daemonSocketUrl(projectBaseUrl: string, path: string): string {
  const url = new URL(projectBaseUrl)
  const projectPath = url.pathname.replace(/\/+$/, '')
  const below = projectPath.startsWith(TASKFLOW_API_MOUNT) ? projectPath.slice(TASKFLOW_API_MOUNT.length) : projectPath
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${TASKFLOW_SOCKET_MOUNT}${below}${path}`
  return url.toString()
}

/** What to do when the daemon cannot be reached. */
export function daemonUnreachableHint(port: number, env: Env = process.env): string {
  return `Could not reach the Portta host daemon at ${daemonOrigin(port, env)}. Start it with \`portta host serve\` (or \`portta host service install\`).`
}
