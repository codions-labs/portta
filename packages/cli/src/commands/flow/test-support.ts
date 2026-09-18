import { type Command, CommanderError } from 'commander'
import type { FlowAction } from './flow-action.ts'
import { createFlowCommand, type FlowRunner } from './index.ts'

export interface FlowParseResult {
  /** The invocation the tree handed to its runner, if it got that far. */
  action?: FlowAction
  exitCode: number
  stdout: string
  stderr: string
}

function captureOutput(command: Command, stdout: string[], stderr: string[]): void {
  command
    .exitOverride()
    .configureOutput({ writeOut: (text) => stdout.push(text), writeErr: (text) => stderr.push(text) })
  for (const subcommand of command.commands) captureOutput(subcommand, stdout, stderr)
}

/** Parse `argv` through the real command tree without touching the process:
 *  output is captured and exits become results. */
export async function parseFlow(
  argv: string[],
  options: { name?: string; run?: FlowRunner } = {},
): Promise<FlowParseResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  let action: FlowAction | undefined
  const run: FlowRunner =
    options.run ??
    (async (received) => {
      action = received
      return 0
    })
  const flow = createFlowCommand({ name: options.name ?? 'taskflow', run })
  captureOutput(flow, stdout, stderr)
  const previousExitCode = process.exitCode
  try {
    await flow.parseAsync(argv, { from: 'user' })
    return { ...(action ? { action } : {}), exitCode: 0, stdout: stdout.join(''), stderr: stderr.join('') }
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error
    return { exitCode: error.exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
  } finally {
    process.exitCode = previousExitCode
  }
}

/** The action `argv` parses to, or the usage error commander reported. */
export async function parseFlowAction(argv: string[]): Promise<FlowAction> {
  const result = await parseFlow(argv)
  if (!result.action) throw new Error(result.stderr || result.stdout)
  return result.action
}
