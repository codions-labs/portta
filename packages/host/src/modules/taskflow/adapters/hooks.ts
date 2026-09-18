import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../lib/log.ts'
import { NodeProcessRunner, type ProcessExit, type ProcessRunner, type ProcessSpec } from './process-runner.ts'

export interface RunLifecycleHookInput {
  command: string
  cwd: string
  env: Record<string, string>
  name: 'postCreate' | 'preRemove'
}

export interface LifecycleHookRunner {
  run(input: RunLifecycleHookInput): Promise<void>
}

function buildErrorMessage(
  name: RunLifecycleHookInput['name'],
  exitCode: number,
  stdout: string,
  stderr: string,
): string {
  const output = stderr.trim() || stdout.trim()
  if (output) {
    return `${name} hook failed (exit ${exitCode}): ${output}`
  }
  return `${name} hook failed (exit ${exitCode})`
}

interface ProcessOutput {
  exit: ProcessExit
  stdout: string
  stderr: string
}

async function runProcess(runner: ProcessRunner, spec: ProcessSpec): Promise<ProcessOutput> {
  const process = runner.start(spec)
  const [exit, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exit, stdout, stderr }
}

async function hasDirenv(runner: ProcessRunner): Promise<boolean> {
  try {
    return (await runProcess(runner, { command: 'direnv', args: ['version'] })).exit.code === 0
  } catch {
    return false
  }
}

export class NodeLifecycleHookRunner implements LifecycleHookRunner {
  private direnvAvailable: boolean | null = null

  private readonly runner: ProcessRunner
  constructor(runner: ProcessRunner = new NodeProcessRunner()) {
    this.runner = runner
  }

  private async checkDirenv(): Promise<boolean> {
    if (this.direnvAvailable === null) {
      this.direnvAvailable = await hasDirenv(this.runner)
    }
    return this.direnvAvailable
  }

  private async buildCommand(cwd: string, command: string): Promise<[string, ...string[]]> {
    if ((await this.checkDirenv()) && (await this.hasEnvrc(cwd))) {
      await runProcess(this.runner, { command: 'direnv', args: ['allow'], cwd })
      return ['direnv', 'exec', cwd, 'bash', '-c', command]
    }
    return ['bash', '-c', command]
  }

  private async hasEnvrc(cwd: string): Promise<boolean> {
    try {
      await access(join(cwd, '.envrc'))
      return true
    } catch {
      return false
    }
  }

  async run(input: RunLifecycleHookInput): Promise<void> {
    const cmd = await this.buildCommand(input.cwd, input.command)
    log.debug(`[hook-runner] Spawning: ${cmd.join(' ')} cwd=${input.cwd}`)
    log.debug(`[hook-runner] envKeys=${Object.keys(input.env).length}`)
    const output = await runProcess(this.runner, {
      command: cmd[0],
      args: cmd.slice(1),
      cwd: input.cwd,
      env: input.env,
    })

    log.debug(`[hook-runner] ${input.name} exitCode=${output.exit.code}`)
    if (output.stdout.trim()) log.debug(`[hook-runner] stdout: ${output.stdout.trim()}`)
    if (output.stderr.trim()) log.debug(`[hook-runner] stderr: ${output.stderr.trim()}`)

    if (output.exit.code !== 0) {
      throw new Error(buildErrorMessage(input.name, output.exit.code ?? 1, output.stdout, output.stderr))
    }
  }
}
