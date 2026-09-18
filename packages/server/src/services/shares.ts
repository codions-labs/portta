// Sharing one service, temporarily, with one person.
//
// Container labels belong to the project and Docker cannot rewrite them on a
// running container, so exposure cannot be flipped that way. Traefik's file
// provider defines routers as well as middlewares and is already watched, so a
// share is an *additional* hostname pointing at a container. The project's own
// router is untouched, and revoking a share deletes a block from one file.
//
// The whole state lives in that file: one JSON line in a comment Traefik
// ignores, and the YAML rendered from it. There is no database and no second
// place to keep in step. See docs/development/adr/0011-bounded-traefik-write-surface.md.

import { randomBytes } from 'node:crypto'
import type { ContainerSummary, Share, ShareMode, ShareState } from 'portta-contracts'
import {
  generatePassword,
  hashPassword,
  SHARES_MARKER as MARKER,
  readProtectionStore,
  removeProtection,
  renderAuthDynamic,
  renderShares,
  setProtection,
  shareRouterName,
  slug,
  writeProtectionStore,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { GENERATED_FILES, readGenerated, writeGenerated } from './dynamic.ts'
import type { Snapshot } from './inventory.ts'

const DEFAULT_TTL_SECONDS = 4 * 3600
export const MAX_TTL_SECONDS = 7 * 24 * 3600
export const MIN_TTL_SECONDS = 60

export class ShareRefused extends Error {
  status = 400
  hint: string
  constructor(message: string, hint = '') {
    super(message)
    this.name = 'ShareRefused'
    this.hint = hint
  }
}

export interface StoredShare {
  id: string
  project: string
  service: string
  container: string
  port: number
  host: string
  mode: ShareMode
  user: string | null
  entryPoint: string
  createdAt: number
  expiresAt: number
}

export { shareRouterName }

/** `<project>-<service>-<id>.share.<domain>`: visibly not a project hostname. */
export function shareHost(config: PanelConfig, project: string, service: string, id: string): string {
  const domain = config.publicDomain ?? config.domain
  return `${slug(project)}-${slug(service)}-${id}.share.${domain}`
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

export { renderShares }

/** Reads the state back out of the file the panel itself wrote. */
export function parseShares(contents: string | null): StoredShare[] {
  if (!contents) return []
  const line = contents.split('\n').find((entry) => entry.startsWith(MARKER))
  if (!line) return []
  try {
    const parsed = JSON.parse(line.slice(MARKER.length)) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is StoredShare => {
      const value = entry as Record<string, unknown>
      return typeof value?.id === 'string' && typeof value?.host === 'string'
    })
  } catch {
    return []
  }
}

export function loadShares(config: PanelConfig): StoredShare[] {
  return parseShares(readGenerated(config.dynamicDir, GENERATED_FILES.shares))
}

export function saveShares(config: PanelConfig, shares: StoredShare[]): void {
  writeGenerated(config.dynamicDir, GENERATED_FILES.shares, renderShares(shares))
}

function shareScope(id: string): string {
  return `share:${id}`
}

function saveProtectionState(config: PanelConfig, store: ReturnType<typeof readProtectionStore>): void {
  writeProtectionStore(config.authStore, store)
  writeGenerated(config.dynamicDir, GENERATED_FILES.auth, renderAuthDynamic(store))
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function stateOf(share: StoredShare, snapshot: Snapshot, now: number): ShareState {
  if (share.expiresAt <= now) return 'expired'
  // A share names a container; recreating it under a different namespace
  // leaves the router pointing at nothing.
  if (!snapshot.containers.some((container) => container.name === share.container)) return 'dangling'
  return 'active'
}

export function listShares(config: PanelConfig, snapshot: Snapshot, now = snapshot.at): Share[] {
  const scheme = config.tlsEnabled ? 'https' : 'http'
  return loadShares(config)
    .map((share) => ({
      id: share.id,
      project: share.project,
      service: share.service,
      container: share.container,
      port: share.port,
      host: share.host,
      url: `${scheme}://${share.host}`,
      mode: share.mode,
      user: share.user,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      expiresInSeconds: Math.max(0, share.expiresAt - now),
      state: stateOf(share, snapshot, now),
    }))
    .sort((a, b) => a.expiresAt - b.expiresAt)
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Refusals, not warnings, following the precedent
 * `scripts/cmd/service-publish.sh` set for datastores. Each of these is a way
 * to expose something nobody asked to expose.
 */
export function assertShareable(container: ContainerSummary, mode: ShareMode, config: PanelConfig): number {
  if (container.kind !== 'http') {
    throw new ShareRefused(
      `${container.name} is not an HTTP service (${container.kind})`,
      'a database is reached with portta access open, never by hostname on the web entrypoint',
    )
  }
  if (!container.onGatewayNetwork) {
    throw new ShareRefused(
      `${container.name} is not on the ${config.network} network`,
      'Traefik dials backends over the shared network; adopt the project first',
    )
  }
  if (container.state !== 'running') {
    throw new ShareRefused(`${container.name} is ${container.state}`, 'start it first')
  }
  if (mode === 'public') {
    if (!config.publicEnabled) {
      throw new ShareRefused(
        'public sharing needs PUBLIC_ENABLED=true',
        'portta public enable, or share it as protected instead',
      )
    }
    if (!config.publicDomain) {
      throw new ShareRefused('public sharing needs PUBLIC_DOMAIN', 'set it in Settings')
    }
  }
  if (mode === 'protected' && config.profile !== 'local' && !config.tlsEnabled) {
    throw new ShareRefused(
      'a password over plaintext HTTP is not protection',
      'enable TLS before sharing anything protected from a remote host',
    )
  }

  const port = backendPort(container)
  if (port === undefined) {
    throw new ShareRefused(
      `${container.name} exposes no port for Traefik to reach`,
      'declare the port in the image or the Compose file',
    )
  }
  return port
}

/**
 * The port Traefik dials for this container.
 *
 * A `loadbalancer.server.port` label wins over the exposed port, because the
 * project already told Traefik which one is right and the image frequently
 * exposes another (a base image's 80 in front of an application on 3000). The
 * share has to reach the same backend the project's own router does, or it
 * answers 502 while looking perfectly configured.
 */
export function backendPort(container: ContainerSummary): number | undefined {
  const label = Object.entries(container.labels)
    .filter(([key]) => key.startsWith('traefik.http.services.') && key.endsWith('.loadbalancer.server.port'))
    .map(([, value]) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0 && value <= 65535)
  return label ?? container.exposedPorts[0]
}

// ---------------------------------------------------------------------------
// Creating, regenerating and revoking
// ---------------------------------------------------------------------------

export interface CreatedShare {
  share: Share
  /** Shown exactly once. Never stored, and never in any later response. */
  password: string | null
}

function ttlOrThrow(requested: number | undefined): number {
  const ttl = requested ?? DEFAULT_TTL_SECONDS
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new ShareRefused(
      `an expiry between ${MIN_TTL_SECONDS}s and ${MAX_TTL_SECONDS}s is required`,
      'a share without an expiry is an exposure nobody remembers to close',
    )
  }
  return Math.floor(ttl)
}

export async function createShare(
  config: PanelConfig,
  snapshot: Snapshot,
  container: ContainerSummary,
  options: { mode: ShareMode; ttlSeconds?: number; user?: string },
  now = Math.floor(Date.now() / 1000),
): Promise<CreatedShare> {
  const port = assertShareable(container, options.mode, config)
  const ttl = ttlOrThrow(options.ttlSeconds)

  const shares = loadShares(config).filter((share) => share.expiresAt > now)
  const project = container.environment ?? 'unknown'
  const service = container.service ?? container.name

  if (shares.some((share) => share.container === container.name)) {
    throw new ShareRefused(
      `${container.name} is already shared`,
      'revoke the existing share first, or regenerate its password',
    )
  }

  const id = randomBytes(2).toString('hex')
  const password = options.mode === 'protected' ? generatePassword() : null
  const user = options.mode === 'protected' ? (options.user ?? 'reviewer') : null

  const stored: StoredShare = {
    id,
    project,
    service,
    container: container.name,
    port,
    host: shareHost(config, project, service, id),
    mode: options.mode,
    user,
    entryPoint: config.tlsEnabled ? 'websecure' : 'web',
    createdAt: now,
    expiresAt: now + ttl,
  }

  if (password && user) {
    const store = setProtection(readProtectionStore(config.authStore), {
      scope: shareScope(id),
      host: stored.host,
      entryPoints: [stored.entryPoint],
      user,
      hash: await hashPassword(password),
      label: service,
      project,
      service,
    })
    // Credential first, router second: an interrupted create cannot expose the
    // destination without the middleware being able to authenticate it.
    saveProtectionState(config, store)
  }
  saveShares(config, [...shares, stored])
  const view = listShares(config, snapshot, now).find((share) => share.id === id)
  if (!view) throw new ShareRefused('the share could not be written')
  return { share: view, password }
}

export async function regenerateShare(
  config: PanelConfig,
  snapshot: Snapshot,
  id: string,
  now = Math.floor(Date.now() / 1000),
): Promise<CreatedShare> {
  const shares = loadShares(config)
  const share = shares.find((entry) => entry.id === id)
  if (!share) throw new ShareRefused(`no share '${id}'`, 'it may have expired and been collected')
  if (share.mode !== 'protected') {
    throw new ShareRefused('a public share has no password to regenerate', 'revoke it instead')
  }

  const password = generatePassword()
  const user = share.user ?? 'reviewer'
  const store = setProtection(readProtectionStore(config.authStore), {
    scope: shareScope(id),
    host: share.host,
    entryPoints: [share.entryPoint],
    user,
    hash: await hashPassword(password),
    label: share.service,
    project: share.project,
    service: share.service,
  })
  saveProtectionState(config, store)

  const view = listShares(config, snapshot, now).find((entry) => entry.id === id)
  if (!view) throw new ShareRefused('the share could not be written')
  return { share: view, password }
}

export function revokeShare(config: PanelConfig, id: string): void {
  const shares = loadShares(config)
  if (!shares.some((share) => share.id === id)) {
    throw new ShareRefused(`no share '${id}'`, 'it may already be gone')
  }
  saveShares(
    config,
    shares.filter((share) => share.id !== id),
  )
  // Router first, credential second: an interruption leaves no route that can
  // accidentally become less protected.
  saveProtectionState(config, removeProtection(readProtectionStore(config.authStore), shareScope(id)))
}
