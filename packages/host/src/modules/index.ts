// The host daemon's half of the official modules.
//
// The one place code outside a module reaches it. Each entry names a manifest
// from `portta-core/modules` and what the module runs on the host: routes under
// `/api/modules/<id>`, sockets under `/ws/modules/<id>/`, and what to release
// on the way down. The panel reaches both through its authorised proxy; nothing
// here decides who may call a route, because the only caller holds the token.
//
import type { Hono } from 'hono'
import type { ModuleManifest } from 'portta-core/modules'
import type { WebSocket } from 'ws'
import { taskflowHostModule } from './taskflow/index.ts'

export interface HostContext {
  /** `$PORTTA_HOME/state/host`: the daemon's own directory. A module keeps its state below it. */
  stateDir: string
  env: Readonly<Record<string, string | undefined>>
}

export interface HostWsRoute {
  /** `/ws/modules/<id>/…`, with `:name` segments. */
  path: string
  /**
   * Whether the matched parameters name something that exists, asked before the
   * handshake completes so a refusal is still a 404 rather than an open socket
   * the module closes at once. Absent, every match is accepted.
   */
  accepts?: (params: Record<string, string>) => boolean
  handle: (socket: WebSocket, context: { params: Record<string, string>; url: URL }) => void
}

export interface HostModule {
  readonly manifest: ModuleManifest
  readonly routes?: (context: HostContext) => Hono
  readonly ws?: (context: HostContext) => HostWsRoute[]
  /** Called once when the daemon stops, after it stops accepting requests. */
  readonly close?: () => void | Promise<void>
}

export const HOST_MODULES = [taskflowHostModule] as const satisfies readonly HostModule[]
