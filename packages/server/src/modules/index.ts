// The panel's half of the official modules.
//
// The one place code outside a module reaches it. Each entry names a manifest
// from `portta-core/modules` and what the module adds to this process: routes
// under `/api/modules/<id>`, WebSocket routes, background jobs, OpenAPI tags,
// MCP tools and container-visible diagnostics. `createApi`, the OpenAPI document and
// `apps/web/server/main.ts` read these helpers rather than a module directly,
// so the fixed lists they already keep stay the base and a module only appends.
//
// Static: every registered module is mounted. A suite passes its own list
// through `deps.modules`; the process uses `SERVER_MODULES`.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Hono } from 'hono'
import type { Diagnostic } from 'portta-contracts'
import type { ModuleManifest } from 'portta-core/modules'
import type { ApiCaller } from 'portta-mcp'
import type { AppDeps } from '../deps.ts'
import type { WsRoute } from '../realtime/ws/upgrade.ts'
import { taskflowServerModule } from './taskflow/index.ts'

/** Background work a module owns, started after the panel listens. */
export interface ModuleJob {
  start(): void
  stop(): void
}

export interface ModuleTag {
  readonly name: string
  readonly description: string
}

export interface ServerModule {
  readonly manifest: ModuleManifest
  /** Mounted at `/api/modules/<id>`, behind the same principal and origin guards as every route. */
  readonly routes?: (deps: AppDeps) => Hono
  /** Paths under `/ws/modules/<id>/`, authorised before the handshake like every other socket. */
  readonly ws?: (deps: AppDeps) => WsRoute[]
  readonly jobs?: (deps: AppDeps) => ModuleJob[]
  /** Tags the module's documented routes use, added to the OpenAPI document. */
  readonly tags?: readonly ModuleTag[]
  /** Adds the module's tools to the panel's MCP transport, calling this API the way the shared tools do. */
  readonly mcp?: (server: McpServer, call: ApiCaller) => void
  /** Checks appended to the panel's own diagnostics. */
  readonly doctor?: (deps: AppDeps) => Diagnostic[] | Promise<Diagnostic[]>
}

export const SERVER_MODULES = [taskflowServerModule] as const satisfies readonly ServerModule[]

type TagOf<M> = M extends { readonly tags: readonly { readonly name: infer Name extends string }[] } ? Name : never

/** The tag names the registered modules add to `ApiTag`. `never` for none. */
export type ModuleApiTag = TagOf<(typeof SERVER_MODULES)[number]>

/** Where a module's routes answer, relative to `/api`. */
export function modulePath(module: Pick<ServerModule, 'manifest'>): string {
  return `/modules/${module.manifest.id}`
}

export function mountModuleRoutes(api: Hono, deps: AppDeps, modules: readonly ServerModule[]): void {
  for (const module of modules) {
    if (module.routes) api.route(modulePath(module), module.routes(deps))
  }
}

export function moduleWsRoutes(deps: AppDeps, modules: readonly ServerModule[]): WsRoute[] {
  return modules.flatMap((module) => {
    const routes = module.ws?.(deps) ?? []
    const prefix = `/ws/modules/${module.manifest.id}/`
    // A module that answered outside its own prefix could shadow a base route,
    // which would be a second, unreviewed answer to the same path.
    for (const route of routes) {
      if (!route.path.startsWith(prefix))
        throw new Error(`module ${module.manifest.id}: WebSocket route ${route.path} is outside ${prefix}`)
    }
    return routes
  })
}

export function moduleJobs(deps: AppDeps, modules: readonly ServerModule[]): ModuleJob[] {
  return modules.flatMap((module) => module.jobs?.(deps) ?? [])
}

export function moduleTags(modules: readonly ServerModule[]): ModuleTag[] {
  return modules.flatMap((module) => [...(module.tags ?? [])])
}

export function registerModuleTools(server: McpServer, call: ApiCaller, modules: readonly ServerModule[]): void {
  for (const module of modules) module.mcp?.(server, call)
}

export async function moduleDiagnostics(deps: AppDeps, modules: readonly ServerModule[]): Promise<Diagnostic[]> {
  const checks = await Promise.all(modules.map(async (module) => (module.doctor ? module.doctor(deps) : [])))
  return checks.flat()
}
