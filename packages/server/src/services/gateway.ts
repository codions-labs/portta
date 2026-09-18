// The gateway's own state, read from the containers it labels as its own.

import type { ContainerState, ContainerSummary, GatewayStatus, Health } from 'portta-contracts'
import type { PanelConfig } from '../config.ts'
import { isProtected, isRouted, schemeFor } from '../config.ts'
import type { Snapshot } from './inventory.ts'

function dashboardStatus(config: PanelConfig): GatewayStatus['dashboard'] {
  const loopback = {
    provider: 'local',
    url: `http://${config.dashboardBindAddress}:${config.dashboardPort}/dashboard/`,
    scope: 'local' as const,
    usable: true,
    shareable: false,
    problem: null,
  }
  if (!config.dashboardEnabled) {
    return {
      enabled: false,
      bindAddress: config.dashboardBindAddress,
      port: config.dashboardPort,
      expose: 'local',
      advertisedHost: null,
      authenticated: false,
      endpoints: [],
    }
  }
  return {
    enabled: true,
    bindAddress: config.dashboardBindAddress,
    port: config.dashboardPort,
    expose: 'local',
    advertisedHost: null,
    authenticated: false,
    endpoints: [loopback],
  }
}

export function componentOf(snapshot: Snapshot, component: string): ContainerSummary | null {
  return (
    snapshot.containers.find(
      (container) => container.ownership === 'gateway' && container.gatewayComponent === component,
    ) ?? null
  )
}

export function gatewayStatus(snapshot: Snapshot, config: PanelConfig): GatewayStatus {
  const traefik = componentOf(snapshot, 'traefik')
  const socketProxy = componentOf(snapshot, 'socket-proxy')
  const tailscale = componentOf(snapshot, 'tailscale')
  const database = componentOf(snapshot, 'db')
  const network = snapshot.networks.find((item) => item.name === config.network) ?? null
  const routes = snapshot.containers.filter(
    (container) => container.ownership !== 'gateway' && container.state === 'running' && container.urls.length > 0,
  ).length

  return {
    gatewayVersion: config.gatewayVersion,
    panelVersion: config.panelVersion,
    profile: config.profile,
    domain: config.domain,
    privateDomain: config.privateDomain,
    publicDomain: config.publicDomain,
    bindAddress: config.bindAddress,
    httpPort: config.httpPort,
    httpsPort: config.httpsPort,
    scheme: schemeFor(config),
    up: traefik?.state === 'running',
    reachable: snapshot.reachable,
    tls: { enabled: config.tlsEnabled, mode: config.tlsMode },
    tailscale: {
      enabled: config.tailscaleEnabled,
      running: tailscale?.state === 'running',
      hostname: config.tailscaleHostname,
    },
    publicAccess: { enabled: config.publicEnabled, domain: config.publicDomain },
    // The panel's own front door. `authenticated` is derived, never the secret
    // itself: that value never leaves this process.
    panel: {
      expose: config.webExpose,
      routed: isRouted(config),
      auth: config.authMode,
      authenticated: isProtected(config),
      readOnly: config.readOnly,
      docs: config.docs,
    },
    dashboard: dashboardStatus(config),
    traefik: {
      containerId: traefik?.id ?? null,
      state: (traefik?.state ?? 'absent') as ContainerState | 'absent',
      health: (traefik?.health ?? 'none') as Health,
    },
    socketProxy: {
      containerId: socketProxy?.id ?? null,
      state: (socketProxy?.state ?? 'absent') as ContainerState | 'absent',
    },
    database: {
      containerId: database?.id ?? null,
      state: (database?.state ?? 'absent') as ContainerState | 'absent',
      health: (database?.health ?? 'none') as Health,
    },
    network: {
      name: config.network,
      exists: network !== null,
      attached: network?.containerCount ?? 0,
      internal: network?.internal ?? false,
    },
    routes,
  }
}

/** Gateway components the panel is allowed to restart. */
export const RESTARTABLE_COMPONENTS = ['traefik', 'socket-proxy', 'tailscale', 'db'] as const
