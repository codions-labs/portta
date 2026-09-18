// The CLI's half of the official modules.
//
// The one place code outside a module reaches it. Each entry names a manifest
// from `portta-core/modules` and what the module adds here: a command group,
// MCP tools and host diagnostics. `cli.ts`, `commands/mcp.ts` and `doctor`
// call these helpers after registering their own, so a module only appends.
//
// Every registered module is on: a command group exists because the build has
// the module, not because an installation asked for it.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Command } from 'commander'
import { type DoctorCheck, mergeEnvironment, parseEnv } from 'portta-core'
import type { ModuleManifest } from 'portta-core/modules'
import type { ApiCaller } from 'portta-mcp'
import { findGatewayRoot, type GatewayContext } from '../context.js'
import { taskflowCliModule } from './taskflow.js'

export interface CliModuleContext {
  /** The installation's `.env` over the inherited environment, as every command reads it. */
  env: Readonly<Record<string, string | undefined>>
}

export interface CliModule {
  readonly manifest: ModuleManifest
  /** Adds the module's commands to the program. */
  readonly register?: (program: Command, context: CliModuleContext) => void
  /** Adds the module's tools to `portta mcp`, calling the panel the way the base tools do. */
  readonly mcp?: (server: McpServer, call: ApiCaller) => void
  /** Checks appended to `portta doctor`. Read-only, like every other check. */
  readonly doctor?: (context: GatewayContext) => Promise<DoctorCheck[]>
}

export const CLI_MODULES = [taskflowCliModule] as const satisfies readonly CliModule[]

/**
 * The environment a module's commands read their settings from, before any
 * command runs: the installation's `.env` over the inherited environment.
 *
 * Deliberately lighter than `gatewayContext`: it runs for `--help` too, so it
 * must not resolve the gateway configuration or refuse a missing installation.
 * An unreadable `.env` is the inherited environment alone.
 */
export function moduleEnvironment(root = findGatewayRoot()): Record<string, string | undefined> {
  const file = root ? join(root, '.env') : null
  if (!file || !existsSync(file)) return { ...process.env }
  try {
    return mergeEnvironment(parseEnv(readFileSync(file, 'utf8')), process.env)
  } catch {
    return { ...process.env }
  }
}

export function registerModuleCommands(
  program: Command,
  context: CliModuleContext,
  modules: readonly CliModule[],
): void {
  for (const module of modules) module.register?.(program, context)
}

export function registerModuleTools(server: McpServer, call: ApiCaller, modules: readonly CliModule[]): void {
  for (const module of modules) module.mcp?.(server, call)
}

export async function moduleDoctorChecks(
  context: GatewayContext,
  modules: readonly CliModule[],
): Promise<DoctorCheck[]> {
  const checks = await Promise.all(modules.map(async (module) => (module.doctor ? module.doctor(context) : [])))
  return checks.flat()
}
