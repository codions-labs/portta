import type { Command, OptionValues } from 'commander'
import { CLI_NAME } from 'portta-core/taskflow/config'

/** Actions `environment` accepts after its target. */
export const ENVIRONMENT_ACTIONS = [
  'status',
  'doctor',
  'trust',
  'services',
  'start',
  'stop',
  'restart',
  'rebuild',
  'destroy',
  'terminal',
  'logs',
  'monitor',
  'exec',
  'service',
  'open',
  'expose',
  'revoke',
] as const

/** Options declared on the flow command itself, before any subcommand. */
export interface FlowGlobals {
  port?: number
}

/** One parsed invocation of the flow command tree, handed to the runner. */
export interface FlowAction {
  /** Command names below the flow command, e.g. `['runs', 'show']`. */
  path: string[]
  /** Declared arguments in order, as commander processed them. */
  args: unknown[]
  options: OptionValues
  globals: FlowGlobals
  /** The command whose action ran. */
  command: Command
  /** The flow command, wherever it sits in a larger program. */
  root: Command
}

export type FlowRunner = (action: FlowAction) => Promise<number>

/** How a person types `command`: every name from the outermost program down,
 *  so help reads `portta flow add` once the tree is embedded. */
export function commandInvocation(command: Command): string {
  const names: string[] = []
  for (let current: Command | null = command; current; current = current.parent) names.unshift(current.name())
  return names.join(' ')
}

let invocation: string = CLI_NAME

/** How the flow command was invoked (`portta flow`), for hints a
 *  handler prints. Module-level like Portta's process reporter: it comes from
 *  argv once, before any handler runs, and a dozen messages read it. */
export function flowInvocation(): string {
  return invocation
}

export function setFlowInvocation(value: string): void {
  invocation = value
}

/** Names from just below `root` down to `command`. */
export function commandPath(root: Command, command: Command): string[] {
  const names: string[] = []
  for (let current: Command | null = command; current && current !== root; current = current.parent) {
    names.unshift(current.name())
  }
  return names
}
