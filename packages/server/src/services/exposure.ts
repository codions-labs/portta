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
export function hostOf(container: ContainerSummary): string {
  const url = container.urls[0]
  if (!url) throw new ExposureRefused(`${container.service ?? container.name} has no hostname`)
  return normalizeProtectionHost(url.host)
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
): Promise<ExposureChange> {
  const host = hostOf(container)
  const store = readProtectionStore(config.authStore)
  const previous = protectionForHost(store, host)
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

export function openService(config: PanelConfig, container: ContainerSummary): ExposureChange {
  const host = hostOf(container)
  const store = readProtectionStore(config.authStore)
  const previous = protectionForHost(store, host)
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

export function closeService(config: PanelConfig, container: ContainerSummary): ExposureChange {
  const host = hostOf(container)
  const store = readProtectionStore(config.authStore)
  const record = protectionForHost(store, host)
  if (!record) throw new ExposureRefused(`${host} has no decision to remove`, 'it is already closed or never decided')
  save(config, removeProtection(store, record.scope))
  return { entry: null, action: 'protection.removed' }
}
