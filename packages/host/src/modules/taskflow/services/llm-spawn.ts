import type { AutoNameConfig } from 'portta-core/taskflow'
import { NodeProcessRunner } from '../adapters/process-runner.ts'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface SpawnOptions {
  timeoutMs?: number
}

export type SpawnLike = (args: string[], options?: SpawnOptions) => Promise<SpawnResult>

export class LlmSpawnTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`LLM spawn timed out after ${timeoutMs}ms`)
    this.timeoutMs = timeoutMs
  }
}

export async function defaultLlmSpawn(args: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const [command, ...commandArgs] = args
  if (command === undefined) throw new Error('LLM command is required')
  const process = new NodeProcessRunner().start({
    command,
    args: commandArgs,
    timeoutMs: options.timeoutMs,
    graceMs: options.timeoutMs === undefined ? undefined : 100,
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exit.timedOut && options.timeoutMs !== undefined) throw new LlmSpawnTimeoutError(options.timeoutMs)
  return { exitCode: exit.code ?? 1, stdout, stderr }
}

function escapeTomlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

export function buildLlmArgs(config: AutoNameConfig, systemPrompt: string, userPrompt: string): string[] {
  if (config.provider === 'claude') {
    return [
      'claude',
      '-p',
      '--system-prompt',
      systemPrompt,
      '--output-format',
      'text',
      '--no-session-persistence',
      '--model',
      config.model || DEFAULT_CLAUDE_MODEL,
      '--effort',
      'low',
      userPrompt,
    ]
  }
  const args = ['codex', '-c', `developer_instructions="${escapeTomlString(systemPrompt)}"`, 'exec', '--ephemeral']
  if (config.model) {
    args.push('-m', config.model)
  }
  args.push(userPrompt)
  return args
}

export type RunLlmResult =
  | { ok: true; stdout: string; stderr: string; args: string[] }
  | { ok: false; kind: 'timeout'; timeoutMs: number; args: string[] }
  | { ok: false; kind: 'spawn_error'; error: unknown; args: string[] }
  | { ok: false; kind: 'exit_nonzero'; exitCode: number; stdout: string; stderr: string; args: string[] }

export interface RunLlmOptions {
  timeoutMs?: number
  spawnImpl?: SpawnLike
}

export async function runShortLlmTask(
  config: AutoNameConfig,
  systemPrompt: string,
  userPrompt: string,
  options: RunLlmOptions = {},
): Promise<RunLlmResult> {
  const args = buildLlmArgs(config, systemPrompt, userPrompt)
  const spawnImpl = options.spawnImpl ?? defaultLlmSpawn

  let result: SpawnResult
  try {
    result = await spawnImpl(args, { timeoutMs: options.timeoutMs })
  } catch (error) {
    if (error instanceof LlmSpawnTimeoutError) {
      return { ok: false, kind: 'timeout', timeoutMs: error.timeoutMs, args }
    }
    return { ok: false, kind: 'spawn_error', error, args }
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      kind: 'exit_nonzero',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      args,
    }
  }

  return { ok: true, stdout: result.stdout, stderr: result.stderr, args }
}

export function llmProviderLabel(config: AutoNameConfig): string {
  return config.provider === 'claude' ? 'claude' : 'codex'
}
