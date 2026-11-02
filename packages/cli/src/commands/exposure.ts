// Who may open a routed hostname, kept in the ForwardAuth registry.
//
// The decision lives here and nowhere in the project: a record in
// `state/auth/protections.json` says the host is protected by a credential, or
// public, and a host with no record is closed. Changing it rewrites the
// registry the auth service reads on every request, so it takes effect at once,
// with no container recreated and no Compose file edited.

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  emptyProtectionStore,
  hashPassword,
  loadGatewayConfig,
  normalizeProtectionHost,
  type ProtectionStore,
  parseAliases,
  parseEnv,
  protectionForHost,
  readProtectionStore,
  removeProtection,
  renderAliasesForStore,
  renderAuthDynamic,
  setProtection,
  writeEnvFile,
  writeProtectionStore,
} from 'portta-core'

export interface ExposurePaths {
  store: string
  dynamic: string
}

export function exposurePaths(root: string): ExposurePaths {
  return {
    store: join(root, 'state/auth/protections.json'),
    dynamic: join(root, 'config/traefik/dynamic/portta-auth.yaml'),
  }
}

export function readExposure(root: string): ProtectionStore {
  return readProtectionStore(exposurePaths(root).store)
}

/** Conflicting aliases are suspended before their hostname's decision becomes active. */
export function saveExposure(root: string, store: ProtectionStore, profile?: string): void {
  const target = exposurePaths(root)
  mkdirSync(dirname(target.store), { recursive: true, mode: 0o700 })
  chmodSync(dirname(target.store), 0o700)
  mkdirSync(dirname(target.dynamic), { recursive: true })
  const aliasFile = join(dirname(target.dynamic), 'portta-aliases.yaml')
  const aliases = existsSync(aliasFile) ? parseAliases(readFileSync(aliasFile, 'utf8')) : null
  let publicHost = false
  if (aliases !== null) {
    const envFile = join(root, '.env')
    publicHost =
      (profile ??
        loadGatewayConfig(existsSync(envFile) ? Object.fromEntries(parseEnv(readFileSync(envFile, 'utf8'))) : {})
          .profile) === 'remote-public'
    writeEnvFile(aliasFile, renderAliasesForStore(aliases, store, publicHost, readProtectionStore(target.store)))
  }
  writeProtectionStore(target.store, store)
  writeEnvFile(target.dynamic, renderAuthDynamic(store))
  if (aliases !== null) writeEnvFile(aliasFile, renderAliasesForStore(aliases, store, publicHost))
}

export function generatePassword(): string {
  return randomBytes(20)
    .toString('base64url')
    .slice(0, 20)
    .match(/.{1,5}/g)!
    .join('-')
}

export interface ExposureLabels {
  label?: string
  project?: string
  service?: string
}

/** Protects a host with a credential. The password is hashed here and never stored. */
export async function protectedStore(
  store: ProtectionStore,
  input: { host: string; entryPoint: string; user: string; password: string } & ExposureLabels,
): Promise<ProtectionStore> {
  const host = normalizeProtectionHost(input.host)
  const previous = protectionForHost(store, host)
  return setProtection(store, {
    scope: previous?.scope ?? `host:${host}`,
    host,
    entryPoints: [input.entryPoint],
    mode: 'protected',
    user: input.user,
    hash: await hashPassword(input.password),
    label: input.label ?? input.service ?? host,
    ...(input.project ? { project: input.project } : {}),
    ...(input.service ? { service: input.service } : {}),
  })
}

/** Opens a host to everybody. There is no credential to keep. */
export function openStore(
  store: ProtectionStore,
  input: { host: string; entryPoint: string } & ExposureLabels,
): ProtectionStore {
  const host = normalizeProtectionHost(input.host)
  const previous = protectionForHost(store, host)
  return setProtection(store, {
    scope: previous?.scope ?? `host:${host}`,
    host,
    entryPoints: [input.entryPoint],
    mode: 'public',
    label: input.label ?? input.service ?? host,
    ...(input.project ? { project: input.project } : {}),
    ...(input.service ? { service: input.service } : {}),
  })
}

export function closedStore(store: ProtectionStore, host: string): ProtectionStore | null {
  const record = protectionForHost(store, normalizeProtectionHost(host))
  return record ? removeProtection(store, record.scope) : null
}

export { emptyProtectionStore }
