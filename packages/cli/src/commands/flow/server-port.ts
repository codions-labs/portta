import { APP_DEFAULTS } from 'portta-core/taskflow/config'

export const SERVER_PORT_ENV = 'PORTTA_HOST_PORT'

/** The port a CLI command talks to (or `serve` binds): `--port` when given,
 *  then `PORTTA_HOST_PORT`, then the default. */
export function resolveServerPort(explicit?: number, env: NodeJS.ProcessEnv = process.env): number {
  if (explicit !== undefined) return explicit
  const fromEnv = Number.parseInt(env[SERVER_PORT_ENV] ?? '', 10)
  return Number.isNaN(fromEnv) ? APP_DEFAULTS.port : fromEnv
}
