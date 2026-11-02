// Shared by the commands that talk to the panel: the panel client with
// its options, the table renderer, and the small parsers.

import type { Command } from 'commander'
import { type PanelClient, type PanelOptions, panelClient } from '../api.js'
import { gatewayContext } from '../context.js'
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

export function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

export function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, value)
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}
