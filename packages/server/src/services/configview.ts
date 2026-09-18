// The Settings view, and the only path that writes to .env.

import { existsSync } from 'node:fs'
import type {
  ConfigDiscardResult,
  ConfigField,
  ConfigPatchResult,
  ConfigView,
  PendingChange,
  ProjectDomain,
} from 'portta-contracts'
import {
  exampleHostnames,
  isDomainMode,
  isWritable,
  parseEnv,
  readEnvFile,
  setEnvValue,
  updateEnvFile,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { FIELDS, FIELDS_BY_KEY, ValidationError, validateCombination, validateValue } from './settings.ts'

/**
 * The base domain the running gateway resolved, and whether it is any use.
 *
 * A hostname is a name, not an exposure: this says nothing about who may reach
 * a service, only whether the name they would be given can reach this host at
 * all. Reporting `demo-web.localhost` to somebody reading the panel over the
 * internet is the failure this exists to catch.
 */
function projectDomainOf(config: PanelConfig): ProjectDomain {
  const mode = isDomainMode(config.domainMode) ? config.domainMode : 'local'
  const isLoopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(config.bindAddress)
  const isLocalName = config.domain === 'localhost' || config.domain.endsWith('.localhost')
  // A name that resolves off this machine is only useful if Traefik answers
  // somewhere that name reaches, which is a separate, deliberate setting.
  const reachable = isLocalName ? isLoopbackOnly : !isLoopbackOnly

  let advice: string | null = null
  if (config.domainProblem) {
    advice =
      mode === 'auto'
        ? 'Set the public address, or run: portta config set domain.mode auto'
        : 'Set a custom domain, or switch the mode back to local.'
  } else if (isLocalName && config.webExpose !== 'local') {
    // The panel is being reached from elsewhere, so localhost is certainly the
    // wrong base: whoever is reading this cannot open any of these URLs.
    advice =
      'This panel is reachable beyond this host, so *.localhost project URLs will not open. Switch the mode to auto.'
  } else if (!isLocalName && isLoopbackOnly) {
    // A name resolving to a tailnet or LAN address is served by binding that
    // address; suggesting public exposure there would be a far larger change
    // than the one needed.
    const ip = config.publicIp ?? ''
    const isPrivate = /^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      ip,
    )
    advice = isPrivate
      ? `These names resolve to ${ip}, but Traefik only listens on loopback. Set the bind address to ${ip} to serve them on that network alone.`
      : 'These names resolve to this host, but Traefik only listens on loopback, so nothing answers from outside. Enable public access to serve them.'
  }

  return {
    mode,
    domain: config.domain,
    publicIp: config.publicIp,
    provider: config.autoDomainProvider,
    examples: exampleHostnames(config.domain),
    problem: config.domainProblem,
    reachable,
    advice,
  }
}

/** Values the running gateway was actually started with. */
function runtimeValue(key: string): string | null {
  const value = process.env[key]
  return value === undefined ? null : value
}

function normaliseBoolean(value: string): string {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase()) ? 'true' : 'false'
}

export function buildConfigView(config: PanelConfig): ConfigView {
  const text = readEnvFile(config.envFile)
  const saved = parseEnv(text)

  const fields: ConfigField[] = FIELDS.map((spec) => {
    const stored = saved.get(spec.key) ?? null
    const running = runtimeValue(spec.key)
    const secret = spec.secret === true
    const compare = (value: string | null) =>
      value === null || value === '' ? '' : spec.kind === 'boolean' ? normaliseBoolean(value) : value
    const display = (value: string) => (spec.kind === 'boolean' ? normaliseBoolean(value) : value)

    const isSet = stored !== null && stored !== ''
    const derivedDefault = spec.key === 'PORTTA_RUNTIME_API_DOCS' ? String(config.apiDocs) : null
    const defaultValue = derivedDefault ?? spec.defaultValue ?? null
    const runningValue = running === null || running === '' ? null : running
    let effectiveValue: string | null = null
    let valueSource: ConfigField['valueSource']
    if (!secret) {
      if (isSet) {
        effectiveValue = display(stored)
        valueSource = 'saved'
      } else if (runningValue !== null && runningValue !== defaultValue) {
        effectiveValue = display(runningValue)
        valueSource = spec.valueSource === 'detected' ? 'detected' : 'environment'
      } else if (defaultValue !== null) {
        effectiveValue = defaultValue
        valueSource = derivedDefault !== null ? 'derived' : 'default'
      } else if (runningValue !== null) {
        effectiveValue = display(runningValue)
        valueSource = spec.valueSource === 'detected' ? 'detected' : 'environment'
      }
    }

    const desired = isSet ? stored : defaultValue
    const actual = runningValue ?? defaultValue

    return {
      key: spec.key,
      value: secret ? null : stored,
      runtimeValue: secret ? null : running,
      effectiveValue: secret ? null : effectiveValue,
      defaultValue: secret ? null : defaultValue,
      ...(valueSource ? { valueSource } : {}),
      secret,
      isSet,
      // Pending means "saved here, not yet in the running gateway". A key
      // absent from .env is on the CLI's default, which is what is running.
      pending: stored !== null && compare(desired) !== compare(actual),
      kind: spec.kind,
      ...(spec.choices ? { choices: spec.choices } : {}),
      group: spec.group,
      label: spec.label,
      help: spec.help,
      restartRequired: spec.restartRequired,
    }
  })

  return {
    fields,
    projectDomain: projectDomainOf(config),
    envFile: {
      path: config.envFile,
      exists: existsSync(config.envFile),
      writable: isWritable(config.envFile),
    },
    pendingRestart: fields.some((field) => field.pending),
    applyCommand: `./bin/portta up ${config.profile}`,
    groups: [...new Set(FIELDS.map((spec) => spec.group))],
  }
}

/**
 * Save, then validate, then report. A patch is all-or-nothing: the file is
 * rewritten once, after every value has been checked on its own and in
 * combination with the others.
 *
 * A secret sent as an empty string means "leave it alone" (the UI never has the
 * current value to send back); sending null clears it.
 */
export function patchConfig(config: PanelConfig, updates: Record<string, string | null>): ConfigPatchResult {
  if (!isWritable(config.envFile)) {
    throw new ValidationError('.env', 'is not writable by the panel')
  }

  const applied = new Map<string, string>()

  for (const [key, raw] of Object.entries(updates)) {
    const spec = FIELDS_BY_KEY.get(key)
    if (!spec) throw new ValidationError(key, 'is not a setting the panel manages')

    if (raw === null) {
      applied.set(key, '')
      continue
    }
    if (spec.secret && raw === '') continue

    const value = spec.kind === 'boolean' ? normaliseBoolean(raw) : raw.trim()
    validateValue(key, value)
    applied.set(key, value)
  }

  updateEnvFile(config.envFile, (current, template) => {
    const merged = parseEnv(current)
    for (const [key, value] of applied) merged.set(key, value)
    validateCombination(merged)
    let next = current
    for (const [key, value] of applied) next = setEnvValue(next, key, value, template)
    return next
  })

  const view = buildConfigView(config)
  return {
    ok: true,
    saved: [...applied.keys()],
    pendingRestart: view.pendingRestart,
    applyCommand: view.applyCommand,
    view,
  }
}

/**
 * The before/after a confirmation needs, including secrets (as presence, never
 * values). Built here so apply status and the settings page agree on one list.
 */
export function pendingChangesOf(fields: ConfigField[]): PendingChange[] {
  return fields
    .filter((field) => field.pending)
    .map((field) => {
      const running = runtimeValue(field.key)
      return {
        key: field.key,
        label: field.label,
        group: field.group,
        from: field.secret ? null : field.runtimeValue,
        to: field.secret ? null : field.value,
        secret: field.secret,
        fromSet: running !== null && running !== '',
        toSet: field.isSet,
        restartRequired: field.restartRequired,
      }
    })
}

/**
 * Put the running values back into `.env`. Secrets work because this process
 * still has them; the client never sees them, so it cannot send them back.
 *
 * `keys` omitted or empty of pending names discards every pending change.
 * A named key that is not pending is skipped. Unknown keys are refused, the
 * same way a patch is.
 */
export function discardConfig(config: PanelConfig, keys?: string[]): ConfigDiscardResult {
  if (!isWritable(config.envFile)) {
    throw new ValidationError('.env', 'is not writable by the panel')
  }

  if (keys) {
    for (const key of keys) {
      if (!FIELDS_BY_KEY.has(key)) throw new ValidationError(key, 'is not a setting the panel manages')
    }
  }

  const view = buildConfigView(config)
  const pending = view.fields.filter((field) => field.pending)
  const wanted = keys === undefined ? pending : pending.filter((field) => keys.includes(field.key))

  if (wanted.length === 0) {
    return {
      ok: true,
      discarded: [],
      pendingRestart: view.pendingRestart,
      applyCommand: view.applyCommand,
      view,
    }
  }

  const applied = new Map<string, string>()

  for (const field of wanted) {
    const spec = FIELDS_BY_KEY.get(field.key)
    if (!spec) throw new ValidationError(field.key, 'is not a setting the panel manages')
    const running = runtimeValue(field.key)
    const value =
      running === null || running === '' ? '' : spec.kind === 'boolean' ? normaliseBoolean(running) : running
    if (value !== '') validateValue(field.key, value)
    applied.set(field.key, value)
  }

  updateEnvFile(config.envFile, (current, template) => {
    const merged = parseEnv(current)
    for (const [key, value] of applied) merged.set(key, value)
    validateCombination(merged)
    let next = current
    for (const [key, value] of applied) next = setEnvValue(next, key, value, template)
    return next
  })

  const after = buildConfigView(config)
  return {
    ok: true,
    discarded: [...applied.keys()],
    pendingRestart: after.pendingRestart,
    applyCommand: after.applyCommand,
    view: after,
  }
}
