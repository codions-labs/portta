// Who may open a service hostname, decided from the panel.
//
// The same registry the CLI writes (`portta protect`, `adopt --protect`), so a
// change takes effect on the next request with no container recreated. A
// generated password is returned once and only its hash is kept.

import type { ContainerSummary, ExposureEntry } from 'portta-contracts'
import {
  generatePassword,
  hashPassword,
  normalizeProtectionHost,
  type ProtectionRecord,
  protectionForHost,
  readProtectionStore,
  removeProtection,
  renderAuthDynamic,
  setProtection,
  writeProtectionStore,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { GENERATED_FILES, writeGenerated } from './dynamic.ts'

export class ExposureRefused extends Error {
  status = 400
  hint: string
  constructor(message: string, hint = 'pick a service that has a hostname') {
    super(message)
    this.name = 'ExposureRefused'
    this.hint = hint
  }
}

export function viewOf(record: ProtectionRecord): ExposureEntry {
  return {
    host: record.host,
    mode: record.mode,
    user: record.user ?? null,
    project: record.project ?? null,
    service: record.service ?? null,
    label: record.label,
  }
}

/** The hostname a routed service answers on. Only a hostname Portta routes can be decided about. */
export function hostOf(container: ContainerSummary, containers: readonly ContainerSummary[] = []): string {
  const hosts = [...new Set(container.urls.map((url) => normalizeProtectionHost(url.host)))]
  if (hosts.length === 0) throw new ExposureRefused(`${container.service ?? container.name} has no hostname`)
  // One decision per call, about one hostname: a service answering on several
  // would be half decided, so it is refused rather than guessed at.
  if (hosts.length > 1)
    throw new ExposureRefused(
      `${container.service ?? container.name} answers on several hostnames`,
      'use `portta protect host <host>` for each one',
    )
  const host = hosts[0]!
  const claimants = containers.filter(
    (other) => other.id !== container.id && other.urls.some((url) => normalizeProtectionHost(url.host) === host),
  )
  if (claimants.length > 0)
    throw new ExposureRefused(`${host} is claimed by more than one container`, 'resolve the duplicate hostname first')
  return host
}

/** A record may only be replaced by the service it belongs to, never one of another project or a share. */
function guard(previous: ProtectionRecord | null, container: ContainerSummary): void {
  if (!previous) return
  if (previous.scope.startsWith('share:'))
    throw new ExposureRefused(`${previous.host} belongs to a temporary share`, 'revoke the share first')
  if (previous.project && container.environment && previous.project !== container.environment)
    throw new ExposureRefused(
      `${previous.host} already has a decision that belongs to ${previous.project}`,
      'remove it with `portta protect remove` if it is stale',
    )
}

function save(config: PanelConfig, store: ReturnType<typeof readProtectionStore>): void {
  writeProtectionStore(config.authStore, store)
  writeGenerated(config.dynamicDir, GENERATED_FILES.auth, renderAuthDynamic(store))
}

export function listExposure(config: PanelConfig): ExposureEntry[] {
  return readProtectionStore(config.authStore)
    .protections.filter((record) => !record.scope.startsWith('share:'))
    .map(viewOf)
}

export interface ExposureChange {
  entry: ExposureEntry | null
  password?: string
  action: 'protection.created' | 'protection.rotated' | 'protection.opened' | 'protection.removed'
}

function entryPointOf(config: PanelConfig): string {
  return config.tlsEnabled ? 'websecure' : 'web'
}

export async function protectService(
  config: PanelConfig,
  container: ContainerSummary,
  options: { user?: string } = {},
  containers: readonly ContainerSummary[] = [],
): Promise<ExposureChange> {
  // A credential typed over plain HTTP is a credential given away.
  if (config.profile !== 'local' && !config.tlsEnabled)
    throw new ExposureRefused('a password cannot be asked for over plain HTTP', 'turn TLS on first')
  const host = hostOf(container, containers)
  const store = readProtectionStore(config.authStore)
  const previous = protectionForHost(store, host)
  guard(previous, container)
  const password = generatePassword()
  const next = setProtection(store, {
    scope: previous?.scope ?? `host:${host}`,
    host,
    entryPoints: [entryPointOf(config)],
    mode: 'protected',
    user: options.user ?? previous?.user ?? 'reviewer',
    hash: await hashPassword(password),
    label: container.service ?? container.name,
    ...(container.environment ? { project: container.environment } : {}),
    ...(container.service ? { service: container.service } : {}),
  })
  save(config, next)
  const record = protectionForHost(next, host)!
  return {
    entry: viewOf(record),
    password,
    action: previous?.mode === 'protected' ? 'protection.rotated' : 'protection.created',
  }
}

export function openService(
  config: PanelConfig,
  container: ContainerSummary,
  containers: readonly ContainerSummary[] = [],
): ExposureChange {
  const host = hostOf(container, containers)
  const store = readProtectionStore(config.authStore)
  const previous = protectionForHost(store, host)
  guard(previous, container)
  const next = setProtection(store, {
    scope: previous?.scope ?? `host:${host}`,
    host,
    entryPoints: [entryPointOf(config)],
    mode: 'public',
    label: container.service ?? container.name,
    ...(container.environment ? { project: container.environment } : {}),
    ...(container.service ? { service: container.service } : {}),
  })
  save(config, next)
  return { entry: viewOf(protectionForHost(next, host)!), action: 'protection.opened' }
}

export function closeService(
  config: PanelConfig,
  container: ContainerSummary,
  containers: readonly ContainerSummary[] = [],
): ExposureChange {
  const host = hostOf(container, containers)
  const store = readProtectionStore(config.authStore)
  const record = protectionForHost(store, host)
  if (!record) throw new ExposureRefused(`${host} has no decision to remove`, 'it is already closed or never decided')
  guard(record, container)
  save(config, removeProtection(store, record.scope))
  return { entry: null, action: 'protection.removed' }
}
