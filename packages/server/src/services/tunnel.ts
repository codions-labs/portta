// Cloudflare Tunnel, as the panel sees and configures it.
//
// Two rules shape everything here.
//
// **The token never comes back.** It arrives once, is turned into the
// credentials file the connector reads, and is never returned by any endpoint,
// written to `.env`, put in a log line, or included in a diagnostic. The panel
// reports `credentialConfigured: true` and offers to replace it. Nothing else.
//
// **The panel does not drive Docker.** Enabling writes configuration and sets
// one variable in `.env`; starting the connector is `portta up`, exactly as it
// is for every other gateway setting ([ADR 0001](../../../../../docs/development/adr/0001-decoupled-infrastructure.md)).
// Inventing a second way to start containers, beside Compose, is the thing the
// architecture most consistently refuses.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TunnelView } from 'portta-contracts'
import {
  describeTunnel,
  InvalidTunnelTokenError,
  parseTunnelToken,
  renderTunnelConfig,
  renderTunnelCredentials,
  tunnelDnsTarget,
  tunnelStatusFrom,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'

export function credentialsPath(config: PanelConfig): string {
  return join(config.tunnelDir, 'credentials.json')
}

export function configPath(config: PanelConfig): string {
  return join(config.tunnelDir, 'config.yml')
}

export function credentialConfigured(config: PanelConfig): boolean {
  return existsSync(credentialsPath(config))
}

/** The tunnel id, read back from the credentials the connector uses. */
export function tunnelIdFromCredentials(config: PanelConfig): string | null {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(config), 'utf8')) as { TunnelID?: unknown }
    return typeof parsed.TunnelID === 'string' ? parsed.TunnelID : null
  } catch {
    return null
  }
}

export class TunnelSetupError extends Error {}

export interface SetupInput {
  zone: string
  token: string
  origin?: string
  includeApex?: boolean
}

/**
 * Turn a pasted token and a domain into a working connector configuration.
 *
 * Everything sensitive stops here: the token becomes `credentials.json` at
 * mode 0600 inside a 0700 directory, and the caller gets back only the tunnel
 * id, which is not a secret.
 */
export function writeTunnelSetup(config: PanelConfig, input: SetupInput): { tunnelId: string; zone: string } {
  const zone = input.zone.trim().toLowerCase()
  if (!zone) throw new TunnelSetupError('a domain is required, for example example.com')

  let credentials: ReturnType<typeof parseTunnelToken>
  try {
    credentials = parseTunnelToken(input.token)
  } catch (error) {
    // The shared decoder's messages are written for a person who just pasted
    // something, and never quote the value.
    if (error instanceof InvalidTunnelTokenError) throw new TunnelSetupError(error.message)
    throw error
  }

  mkdirSync(config.tunnelDir, { recursive: true, mode: 0o700 })

  const origin = input.origin?.trim() || 'http://traefik:80'
  // Rendered before anything is written: a zone that cannot become a wildcard
  // must not leave a credentials file behind for a tunnel that will not run.
  const rendered = renderTunnelConfig({
    id: credentials.TunnelID,
    zone,
    origin,
    credentialsFile: '/etc/cloudflared/credentials.json',
    includeApex: input.includeApex === true,
  })

  writeFileSync(credentialsPath(config), renderTunnelCredentials(credentials), { mode: 0o600 })
  writeFileSync(configPath(config), rendered, { mode: 0o644 })

  return { tunnelId: credentials.TunnelID, zone }
}

/** Remove the connector's configuration. Never touches the Cloudflare account. */
export function forgetTunnel(config: PanelConfig): void {
  for (const path of [credentialsPath(config), configPath(config)]) {
    try {
      writeFileSync(path, '')
    } catch {
      // Already gone, or never written. Either way there is nothing to forget.
    }
  }
}

export interface TunnelObservation {
  containerState: string | null
  containerHealth: string | null
  logTail: string
  /** HTTP services that could be published through the tunnel. */
  endpointCount: number
  imageAvailable: boolean
}

/**
 * The whole view the panel renders, built from configuration plus what the
 * connector container is actually doing.
 */
export function tunnelView(config: PanelConfig, observed: TunnelObservation): TunnelView {
  const zone = config.tunnelZone
  const hasCredential = credentialConfigured(config)
  const tunnelId = tunnelIdFromCredentials(config)

  const status = tunnelStatusFrom({
    tokenConfigured: hasCredential,
    zoneConfigured: Boolean(zone),
    enabled: config.tunnelEnabled,
    containerState: observed.containerState,
    containerHealth: observed.containerHealth,
    logTail: observed.logTail,
  })

  const routes =
    zone && tunnelId
      ? describeTunnel({
          id: tunnelId,
          zone,
          origin: 'http://traefik:80',
          credentialsFile: '/etc/cloudflared/credentials.json',
        }).map((line) => {
          const [hostname, service] = line.split(' -> ')
          return { hostname: hostname ?? line, service: service ?? '' }
        })
      : []

  return {
    state: status.state,
    detail: status.detail,
    hint: status.hint,
    enabled: config.tunnelEnabled,
    zone: zone ?? null,
    wildcard: zone ? `*.${zone}` : null,
    tunnelId,
    credentialConfigured: hasCredential,
    container: {
      name: `${config.projectName}-cloudflared-1`,
      state: observed.containerState ?? 'absent',
      health: observed.containerHealth ?? 'none',
    },
    routes,
    endpointCount: observed.endpointCount,
    dnsRecord:
      zone && tunnelId ? { type: 'CNAME', name: `*.${zone}`, target: tunnelDnsTarget(tunnelId), proxied: true } : null,
    imageAvailable: observed.imageAvailable,
  }
}
