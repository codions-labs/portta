// Applying saved settings, from the panel.
//
// Traefik reads its static configuration from the environment its container was
// created with (ADR 0003), so a saved setting takes effect only once the gateway
// containers are *recreated* — and recreating them means Compose, which this
// process deliberately cannot reach (ADR 0008). The host closes that gap by
// preparing one container, stopped, whose command is fixed at creation time:
// `portta up`, with no argument this panel can influence. Starting a container
// is a permission the panel already had. See ADR 0026.
//
// Every field below is read back from that container rather than remembered
// here, because the apply recreates this process: whatever we held in memory is
// gone by the time there is an answer to report.

import type { ApplyState, ApplyStatus, ApplyUnavailableReason, ConfigField } from 'portta-contracts'
import { applyRefusal, isTrue, parseEnv, readEnvFile } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { buildConfigView, pendingChangesOf } from './configview.ts'
import type { DockerClient } from './docker/client.ts'
import { componentOf } from './gateway.ts'
import type { Snapshot } from './inventory.ts'

/** The label `portta up` puts on the container it prepares. */
export const APPLY_COMPONENT = 'apply'

const LOG_TAIL = 40

/**
 * Saved keys that change where this panel answers. When one of them is pending,
 * the browser tab watching the apply will never reconnect on its own, and a
 * progress dialog that does not say so is a hang dressed up as a wait.
 *
 * PORTTA_DOMAIN is here only when the panel is routed: on loopback the address
 * is an IP and a port, which the domain does not touch.
 */
const MOVES_PANEL = ['PORTTA_WEB_PORT', 'PORTTA_WEB_BIND_ADDRESS', 'PORTTA_WEB_EXPOSE']

/** Docker writes a zero time rather than an absent one; both mean "never". */
function seconds(value: string | undefined | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) || ms <= 0 ? null : Math.floor(ms / 1000)
}

function movesPanel(pending: ConfigField[], config: PanelConfig): boolean {
  const keys = pending.map((field) => field.key)
  if (keys.some((key) => MOVES_PANEL.includes(key))) return true
  return config.webExpose !== 'local' && keys.includes('PORTTA_DOMAIN')
}

/**
 * Three different situations produce the same missing container, and each has a
 * different fix. Telling someone to set a key they have already set — which is
 * what a single fixed sentence did — sends them to the wrong file entirely.
 *
 * The saved `.env` is the only place to read this from. `PORTTA_APPLY` is
 * deliberately not in the panel's field catalogue and is never passed into this
 * container's environment, so that the panel cannot enable itself (ADR 0026);
 * reading the file to *explain* itself takes nothing that was withheld.
 */
function whyUnavailable(saved: Map<string, string>): {
  unavailableReason: ApplyUnavailableReason
  reason: string
} {
  const env = Object.fromEntries(saved)

  if (!isTrue(saved.get('PORTTA_APPLY') ?? 'false')) {
    return {
      unavailableReason: 'disabled',
      reason: 'set PORTTA_APPLY=true on the host, then run the command once',
    }
  }

  // The host's own words, so the panel and the terminal agree on the reason.
  const refusal = applyRefusal(env)
  if (refusal !== null) return { unavailableReason: 'refused', reason: refusal }

  // The key is on and nothing objects, so the applier is simply not built yet:
  // `up` prepares it, and has not run since the key was turned on.
  return {
    unavailableReason: 'not-prepared',
    reason: 'PORTTA_APPLY is true, but the applier has not been prepared yet: run the command once',
  }
}

/**
 * Whether `up` will build before it converges. Both overlays add a `build:`
 * stanza whose context is the repository root, and on a cold cache that is
 * `npm ci` twice over — minutes. The panel says so up front rather than
 * letting a long silence look like a failure.
 */
function buildsImages(saved: Map<string, string>): boolean {
  return isTrue(saved.get('PORTTA_WEB_BUILD') ?? 'false') || isTrue(saved.get('PORTTA_WEB_DEV') ?? 'false')
}

export function applier(snapshot: Snapshot) {
  return componentOf(snapshot, APPLY_COMPONENT)
}

export async function applyStatus(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  options: { logs?: boolean } = {},
): Promise<ApplyStatus> {
  const view = buildConfigView(config)
  const pending = view.fields.filter((field) => field.pending)
  // The file the host will read on its next `up`, not this process's
  // environment: the panel is explaining a decision the host makes.
  const saved = parseEnv(readEnvFile(config.envFile))
  const common = {
    pendingRestart: view.pendingRestart,
    pendingKeys: pending.map((field) => field.key),
    pendingChanges: pendingChangesOf(view.fields),
    movesPanel: movesPanel(pending, config),
    buildsImages: buildsImages(saved),
    profile: config.profile,
    applyCommand: view.applyCommand,
  }

  const container = applier(snapshot)
  if (!container) {
    const { unavailableReason, reason } = whyUnavailable(saved)
    return {
      ...common,
      state: 'unavailable',
      available: false,
      reason,
      unavailableReason,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      logTail: [],
    }
  }

  const inspect = await client.inspect(container.id)
  const startedAt = seconds(inspect.State.StartedAt)
  const finishedAt = seconds(inspect.State.FinishedAt)

  // An exit code only describes a run that happened. A container that is still
  // running has not produced one, and one that was created and never started
  // carries whatever Docker left there — reporting either as a result would be
  // inventing an outcome.
  const ran = startedAt !== null
  const exitCode = ran && !inspect.State.Running ? (inspect.State.ExitCode ?? null) : null

  const state: ApplyState = inspect.State.Running ? 'running' : !ran ? 'idle' : exitCode === 0 ? 'ok' : 'failed'

  // `docker start` on an exited container appends to the same log, so a bare
  // tail would show the previous apply. Read only what this run wrote.
  const wanted = options.logs === true || state === 'failed'
  const logTail = wanted
    ? (await client.logs(container.id, { tail: LOG_TAIL, since: startedAt ?? undefined })).map((line) => line.text)
    : []

  return {
    ...common,
    state,
    available: true,
    reason: null,
    unavailableReason: null,
    startedAt,
    finishedAt,
    exitCode,
    logTail,
  }
}
