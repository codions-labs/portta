import type { Command } from 'commander'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'
import { ensureToolbox, runInToolbox } from '../toolbox.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

export async function toolboxBuild(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const image = await ensureToolbox(context.root, context.version)
  const output = new Output(globals(command))
  if (globals(command).json) output.data({ image })
  else output.progress(`toolbox ready: ${image}`)
}

export async function toolboxRun(args: string[], command: Command): Promise<void> {
  if (args.length === 0) throw new UsageError('toolbox run needs a command')
  const context = gatewayContext({ profile: globals(command).profile })
  const result = await runInToolbox(context.root, args, { network: 'bridge' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.exitCode !== 0) process.exitCode = result.exitCode
}
