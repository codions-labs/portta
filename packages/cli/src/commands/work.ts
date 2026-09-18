// Shared by the project, session and activity commands: the panel client with
// its options, the table renderer, and the small parsers.

import type { Command } from 'commander'
import { type PanelClient, type PanelOptions, panelClient } from '../api.js'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'

export interface WorkGlobals extends PanelOptions {
  json?: boolean
  quiet?: boolean
  verbose?: boolean
  profile?: string
}

export function workGlobals(command: Command): WorkGlobals {
  return command.optsWithGlobals() as WorkGlobals
}

export function clientFor(
  command: Command,
  overrides: Partial<PanelOptions> = {},
): { client: PanelClient; output: Output; globals: WorkGlobals } {
  const globals = { ...workGlobals(command), ...overrides }
  const context = gatewayContext({ profile: globals.profile, required: false })
  return { client: panelClient(context, globals), output: new Output(globals), globals }
}

/** Plain columns, padded, for a terminal. JSON callers never see this. */
export function table(output: Output, rows: string[][]): void {
  if (rows.length === 0) return
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)))
  for (const row of rows)
    output.line(
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
        .join('  ')
        .trimEnd(),
    )
}

export function requireProject(value: string | undefined): string {
  if (!value) throw new UsageError('--project <slug> is required', 'list them with `portta projects list`')
  return value
}

export function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

export function ago(seconds: number | null | undefined, now = Math.floor(Date.now() / 1000)): string {
  if (!seconds) return '-'
  const delta = Math.max(0, now - seconds)
  if (delta < 60) return `${delta}s`
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  return `${Math.floor(delta / 86400)}d`
}

export function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, value)
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}
