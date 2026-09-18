// The project runner: a container the gateway created stopped, which the
// panel may start. Every field is derived from that container rather than
// remembered here. See ADR 0030.

import type { RunnerState, RunnerStatus, RunnerUnavailableReason } from 'portta-contracts'
import { isTrue, parseEnv, readEnvFile, runnerRefusal } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { DockerClient } from './docker/client.ts'
import { componentOf } from './gateway.ts'
import type { Snapshot } from './inventory.ts'

export const RUNNER_COMPONENT = 'runner'

const LOG_TAIL = 40

function seconds(value: string | undefined | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) || ms <= 0 ? null : Math.floor(ms / 1000)
}

function whyUnavailable(saved: Map<string, string>): {
  unavailableReason: RunnerUnavailableReason
  reason: string
} {
  const env = Object.fromEntries(saved)

  if (!isTrue(saved.get('PORTTA_RUNNER') ?? 'false')) {
    return {
      unavailableReason: 'disabled',
      reason: 'set PORTTA_RUNNER=true on the host, then run the command once',
    }
  }

  const refusal = runnerRefusal(env)
  if (refusal !== null) return { unavailableReason: 'refused', reason: refusal }

  return {
    unavailableReason: 'not-prepared',
    reason: 'PORTTA_RUNNER is true, but the runner has not been prepared yet: run the command once',
  }
}

export function runnerOf(snapshot: Snapshot) {
  return componentOf(snapshot, RUNNER_COMPONENT)
}

export async function runnerStatus(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  options: { logs?: boolean } = {},
): Promise<RunnerStatus> {
  const saved = parseEnv(readEnvFile(config.envFile))
  const prepareCommand = `./bin/portta up ${config.profile}`

  const container = runnerOf(snapshot)
  if (!container) {
    const { unavailableReason, reason } = whyUnavailable(saved)
    return {
      state: 'unavailable',
      available: false,
      reason,
      unavailableReason,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      logTail: [],
      prepareCommand,
    }
  }

  const inspect = await client.inspect(container.id)
  const startedAt = seconds(inspect.State.StartedAt)
  const finishedAt = seconds(inspect.State.FinishedAt)
  const ran = startedAt !== null
  const exitCode = ran && !inspect.State.Running ? (inspect.State.ExitCode ?? null) : null

  const state: RunnerState = inspect.State.Running ? 'running' : !ran ? 'idle' : exitCode === 0 ? 'ok' : 'failed'

  const wanted = options.logs === true || state === 'failed'
  const logTail = wanted
    ? (await client.logs(container.id, { tail: LOG_TAIL, since: startedAt ?? undefined })).map((line) => line.text)
    : []

  return {
    state,
    available: true,
    reason: null,
    unavailableReason: null,
    startedAt,
    finishedAt,
    exitCode,
    logTail,
    prepareCommand,
  }
}
