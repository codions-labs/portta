// Where the daemon listens.
//
// Loopback by default. A panel in a container reaches it at
// `host.docker.internal`: on Docker Desktop that already arrives on loopback,
// while on Linux it is the bridge gateway, so the daemon has to bind that
// address instead (`PORTTA_HOST_BIND=172.17.0.1`). Never `0.0.0.0` by default:
// the token is the only thing between the network and the host's shell.

export const DEFAULT_HOST_BIND = '127.0.0.1'
export const DEFAULT_HOST_PORT = 5111

export interface HostListen {
  host: string
  port: number
}

export function hostListen(env: Readonly<Record<string, string | undefined>>): HostListen {
  const host = env.PORTTA_HOST_BIND?.trim() || DEFAULT_HOST_BIND
  const raw = env.PORTTA_HOST_PORT?.trim() || String(DEFAULT_HOST_PORT)
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`PORTTA_HOST_PORT must be a port number, not ${raw}`)
  return { host, port }
}
