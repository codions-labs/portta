// TCP access: the same bridges `portta access open` creates.
//
// The panel creates them with byte-identical labels so the CLI keeps seeing
// them (`access list`, `access close`, `access gc`) and neither tool is
// surprised by the other's work. Bridges always bind loopback: the panel
// offers no way to publish a database anywhere else.

import { randomBytes } from 'node:crypto'
import type {
  Bridge,
  ContainerSummary,
  Forwarder,
  ServiceConnection,
  ServiceEndpoint,
  ServiceKind,
  TcpService,
} from 'portta-contracts'
import {
  type AutoDomainProvider,
  capabilitiesFrom,
  connectionString,
  credentialsFromEnv,
  type DetectedFacts,
  defaultPortForImage,
  type Endpoint,
  type ExposureProvider,
  emptyFacts,
  endpointsFor,
  gatewayConnectionString,
  isAutoDomainProvider,
  parseContainerEnv,
  serviceKind,
  slug,
  tcpRouting,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { DockerClient } from './docker/client.ts'
import type { Snapshot } from './inventory.ts'
import { LABELS } from './labels.ts'

export const BRIDGE_BIND_IP = '127.0.0.1'
const MAX_TTL_SECONDS = 24 * 3600

function numberLabel(container: ContainerSummary, key: string): number | null {
  const raw = container.labels[key]
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function bridgeFrom(container: ContainerSummary): Bridge | null {
  const id = container.labels[LABELS.accessId]
  if (!id) return null
  const binding = container.ports[0] ?? null
  const kind = (container.labels[LABELS.accessKind] ?? 'tcp') as ServiceKind
  const localPort = binding?.hostPort ?? null
  const bindIp = binding?.ip ?? BRIDGE_BIND_IP
  return {
    id,
    containerId: container.id,
    project: container.labels[LABELS.accessProject] ?? '',
    service: container.labels[LABELS.accessService] ?? '',
    targetPort: numberLabel(container, LABELS.accessPort) ?? 0,
    localPort,
    bindIp,
    kind,
    network: container.labels[LABELS.accessNetwork] ?? '',
    createdAt: numberLabel(container, LABELS.accessCreated),
    expiresAt: numberLabel(container, LABELS.accessExpires),
    state: container.state,
    connectionString: localPort ? connectionString(kind, bindIp, localPort) : '',
  }
}

export function forwarderFrom(container: ContainerSummary): Forwarder | null {
  const alias = container.labels[LABELS.forwardAlias]
  if (!alias) return null
  return {
    alias,
    containerId: container.id,
    project: container.labels[LABELS.forwardProject] ?? '',
    service: container.labels[LABELS.forwardService] ?? '',
    port: numberLabel(container, LABELS.forwardPort) ?? 0,
    kind: (container.labels[LABELS.forwardKind] ?? 'tcp') as ServiceKind,
    state: container.state,
    networks: container.networks,
  }
}

export function listBridges(snapshot: Snapshot): Bridge[] {
  return snapshot.containers
    .filter((container) => container.gatewayComponent === 'access-bridge')
    .map(bridgeFrom)
    .filter((bridge): bridge is Bridge => bridge !== null)
    .sort((a, b) => `${a.project}/${a.service}`.localeCompare(`${b.project}/${b.service}`))
}

export function listForwarders(snapshot: Snapshot): Forwarder[] {
  return snapshot.containers
    .filter((container) => container.gatewayComponent === 'access-forwarder')
    .map(forwarderFrom)
    .filter((forwarder): forwarder is Forwarder => forwarder !== null)
    .sort((a, b) => a.alias.localeCompare(b.alias))
}

/** Mirrors portta_container_private_networks: the project's own networks only. */
export function privateNetworks(container: ContainerSummary, config: PanelConfig): string[] {
  const ours = new Set([config.network, config.controlNetwork, config.accessNetwork])
  return container.networks.filter((name) => !ours.has(name))
}

export function factsFromConfig(config: PanelConfig): DetectedFacts {
  const tailscale = emptyFacts().tailscale
  return {
    ...emptyFacts(),
    publicIpv4: config.publicIp,
    customDomain: config.domainMode === 'custom' ? config.domain : null,
    resolvedDomain: config.domain,
    tlsEnabled: config.tlsEnabled,
    bindAddress: config.bindAddress,
    tailscale: {
      ...tailscale,
      installed: config.tailscaleEnabled,
      connected: config.tailscaleEnabled,
      magicDns: config.tailscaleEnabled ? config.tailscaleHostname : null,
    },
  }
}

export function exposuresFromConfig(config: PanelConfig): ExposureProvider[] {
  const exposures: ExposureProvider[] = []
  if (config.domainMode === 'auto') exposures.push('auto-domain')
  if (config.domainMode === 'custom') exposures.push('custom-domain')
  if (config.tailscaleEnabled) exposures.push('tailscale')
  if (config.publicEnabled) exposures.push('public-ip')
  if (config.privateDomain) exposures.push('lan')
  return exposures
}

export function hostOfAddress(address: string): string {
  const cut = address.lastIndexOf(':')
  return cut > 0 ? address.slice(0, cut) : address
}

export function datastoreEndpoints(
  container: ContainerSummary,
  kind: ServiceKind,
  config: PanelConfig,
  bridge: Bridge | null = null,
): Endpoint[] {
  const facts = factsFromConfig(config)
  const port = defaultPortForImage(container.image) ?? container.exposedPorts[0] ?? 0
  return endpointsFor(
    {
      project: container.environment ?? '',
      service: container.service ?? '',
      container: container.name,
      port,
      kind,
    },
    {
      facts,
      capabilities: capabilitiesFrom(facts),
      exposures: exposuresFromConfig(config),
      autoDomainProvider: isAutoDomainProvider(config.autoDomainProvider)
        ? (config.autoDomainProvider as AutoDomainProvider)
        : 'sslip.io',
      tcpRouted: config.tcpEnabled && isTcpRouted(container),
      tcpPort: config.tcpPorts[kind],
      bridge: bridge?.localPort ? { host: bridge.bindIp, port: bridge.localPort } : undefined,
    },
  )
}

/**
 * The address a client uses when a datastore is routed by hostname, or null.
 *
 * Derived from the shared endpoint model so the panel and Traefik cannot
 * disagree about the hostname.
 */
export function gatewayAddressFor(
  container: ContainerSummary,
  kind: ServiceKind,
  config: PanelConfig,
): { address: string; connectionString: string } | null {
  if (!config.tcpEnabled) return null
  const port = config.tcpPorts[kind]
  if (!port) return null
  if (!isTcpRouted(container)) return null

  const routed = datastoreEndpoints(container, kind, config).find((entry) => entry.provider === 'local')
  if (!routed) return null
  return {
    address: routed.url,
    connectionString: gatewayConnectionString(kind, hostOfAddress(routed.url), port),
  }
}

function connectionStringFor(
  kind: ServiceKind,
  entry: Endpoint,
  credentials?: { user?: string | null; password?: string | null; database?: string | null },
): string {
  const host = hostOfAddress(entry.url)
  const port = Number(entry.url.slice(host.length + 1))
  const routed = entry.provider !== 'internal' && entry.provider !== 'bridge'
  if (routed) return gatewayConnectionString(kind, host, port, credentials)
  return connectionString(kind, host, port, credentials)
}

export function decorateEndpoints(
  kind: ServiceKind,
  entries: Endpoint[],
  credentials?: { user?: string | null; password?: string | null; database?: string | null },
): ServiceEndpoint[] {
  return entries.map((entry) => ({
    provider: entry.provider,
    url: entry.url,
    scope: entry.scope,
    usable: entry.usable,
    shareable: entry.shareable,
    problem: entry.problem,
    connectionString: connectionStringFor(kind, entry, credentials),
  }))
}

export function serviceConnection(
  container: ContainerSummary,
  env: string[] | null | undefined,
  config: PanelConfig,
  bridge: Bridge | null,
): ServiceConnection {
  const kind = serviceKind(container.image)
  const discovered = credentialsFromEnv(kind, parseContainerEnv(env))
  const credentials = discovered.credentials
  return {
    project: container.environment ?? '',
    service: container.service ?? '',
    kind,
    endpoints: decorateEndpoints(kind, datastoreEndpoints(container, kind, config, bridge), credentials ?? undefined),
    credentials: {
      discovered: credentials !== null,
      user: credentials?.user ?? null,
      password: credentials?.password ?? null,
      database: credentials?.database ?? null,
      source: credentials?.source ?? null,
      reason: discovered.reason,
    },
  }
}

/** A container opts in by carrying TCP router labels, and no other way. */
export function isTcpRouted(container: ContainerSummary): boolean {
  return Object.keys(container.labels).some((key) => key.startsWith('traefik.tcp.routers.'))
}

export function listTcpServices(snapshot: Snapshot, config: PanelConfig): TcpService[] {
  const bridges = listBridges(snapshot)
  const forwarders = listForwarders(snapshot)

  return snapshot.containers
    .filter(
      (container) =>
        container.ownership !== 'gateway' &&
        container.environment !== null &&
        container.service !== null &&
        // Reached over HTTP, so a bridge is not how you get to it. Opting into
        // TCP routing also sets traefik.enable, which is why this asks whether
        // the container ended up with a URL rather than whether it is labelled.
        container.urls.length === 0,
    )
    .map((container) => {
      const kind = serviceKind(container.image)
      const bridge = bridges.find(
        (item) => item.project === container.environment && item.service === container.service,
      )
      const forwarder = forwarders.find(
        (item) => item.project === container.environment && item.service === container.service,
      )
      const gateway = gatewayAddressFor(container, kind, config)
      return {
        containerId: container.id,
        project: container.environment ?? '',
        service: container.service ?? '',
        image: container.image,
        kind,
        tech: container.tech,
        routing: tcpRouting(kind),
        routed: isTcpRouted(container),
        gatewayAddress: gateway?.address ?? null,
        gatewayConnectionString: gateway?.connectionString ?? null,
        state: container.state,
        health: container.health,
        ports: container.exposedPorts,
        defaultPort: defaultPortForImage(container.image),
        publishedPorts: container.ports,
        privateNetworks: privateNetworks(container, config),
        bridge: bridge ?? null,
        forwarder: forwarder ?? null,
        integrated: container.ownership === 'integrated',
      }
    })
    .filter((service) => service.kind !== 'tcp' || service.ports.length > 0)
    .sort((a, b) => `${a.project}/${a.service}`.localeCompare(`${b.project}/${b.service}`))
}

export class AccessError extends Error {
  hint: string
  status: number
  constructor(message: string, hint = '', status = 400) {
    super(message)
    this.name = 'AccessError'
    this.hint = hint
    this.status = status
  }
}

export interface OpenBridgeRequest {
  project: string
  service: string
  port?: number
  localPort?: number
  ttlSeconds?: number
}

export function resolveBridgePlan(
  snapshot: Snapshot,
  config: PanelConfig,
  request: OpenBridgeRequest,
): { container: ContainerSummary; port: number; network: string; kind: ServiceKind } {
  const container = snapshot.containers.find(
    (item) =>
      item.environment === request.project &&
      item.service === request.service &&
      !item.oneOff &&
      item.state === 'running',
  )
  if (!container) {
    throw new AccessError(
      `no running container for ${request.project}/${request.service}`,
      'the service must be running before a bridge can reach it',
      404,
    )
  }

  let port = request.port ?? null
  if (port === null) {
    if (container.exposedPorts.length === 1) {
      port = container.exposedPorts[0] ?? null
    } else {
      port = defaultPortForImage(container.image)
    }
  }
  if (port === null) {
    throw new AccessError(
      `cannot tell which port to forward for ${request.project}/${request.service}`,
      container.exposedPorts.length
        ? `the container exposes: ${container.exposedPorts.join(', ')}`
        : 'name the port explicitly',
    )
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AccessError(`invalid target port: ${port}`)
  }

  const candidates = privateNetworks(container, config)
  let network = candidates.length === 1 ? candidates[0] : undefined
  if (!network) {
    network = candidates.find((name) => name === `${request.project}_default`)
  }
  if (!network) {
    if (candidates.length === 0) {
      throw new AccessError(
        `${request.project}/${request.service} is not on any private network the gateway can join`,
        'the service has no network of its own to bridge into',
      )
    }
    throw new AccessError(
      `${request.project}/${request.service} is on several networks`,
      `choose one from the CLI: ${candidates.join(', ')}`,
    )
  }

  return { container, port, network, kind: serviceKind(container.image) }
}

export async function openBridge(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  request: OpenBridgeRequest,
): Promise<{ bridgeId: string; containerId: string }> {
  const existing = listBridges(snapshot).find(
    (bridge) => bridge.project === request.project && bridge.service === request.service,
  )
  if (existing) return { bridgeId: existing.id, containerId: existing.containerId }

  const plan = resolveBridgePlan(snapshot, config, request)

  let ttl: number | null = null
  if (request.ttlSeconds !== undefined && request.ttlSeconds !== null) {
    if (!Number.isInteger(request.ttlSeconds) || request.ttlSeconds < 30) {
      throw new AccessError('a time to live must be at least 30 seconds')
    }
    ttl = Math.min(request.ttlSeconds, MAX_TTL_SECONDS)
  }

  if (request.localPort !== undefined && request.localPort !== null) {
    if (!Number.isInteger(request.localPort) || request.localPort < 1024 || request.localPort > 65535) {
      throw new AccessError('a local port must be between 1024 and 65535')
    }
  }

  const id = randomBytes(3).toString('hex')
  const name = `portta-access-${slug(request.project)}-${slug(request.service)}-${id}`
  const now = Math.floor(Date.now() / 1000)

  const labels: Record<string, string> = {
    [LABELS.managed]: 'true',
    [LABELS.component]: 'access-bridge',
    [LABELS.accessId]: id,
    [LABELS.accessProject]: request.project,
    [LABELS.accessService]: request.service,
    [LABELS.accessPort]: String(plan.port),
    [LABELS.accessNetwork]: plan.network,
    [LABELS.accessKind]: plan.kind,
    [LABELS.accessCreated]: String(now),
    [LABELS.traefikEnable]: 'false',
  }
  if (ttl !== null) labels[LABELS.accessExpires] = String(now + ttl)

  let containerId: string
  try {
    containerId = await client.createBridge({
      name,
      image: config.bridgeImage,
      network: plan.network,
      targetService: request.service,
      targetPort: plan.port,
      bindIp: BRIDGE_BIND_IP,
      hostPort: request.localPort ?? null,
      labels,
      ttlSeconds: ttl,
    })
  } catch (cause) {
    const message = String((cause as Error)?.message ?? cause)
    if (/no such image/i.test(message)) {
      throw new AccessError(
        `the bridge image ${config.bridgeImage} is not on this host`,
        `pull it once from the host: docker pull ${config.bridgeImage}`,
        409,
      )
    }
    throw new AccessError(`could not open the bridge: ${message}`, '', 502)
  }

  // A bridge that cannot reach its target should fail loudly, not look open.
  await new Promise((resolve) => setTimeout(resolve, config.bridgeSettleMs))
  const inspect = await client.inspect(containerId).catch(() => null)
  if (inspect && inspect.State.Status !== 'running') {
    const logs = await client.logs(containerId, { tail: 5 }).catch(() => [])
    await client.remove(containerId, true).catch(() => undefined)
    throw new AccessError(
      'the bridge exited immediately',
      logs.map((line) => line.text).join(' ') ||
        `is ${request.service} reachable on port ${plan.port} from ${plan.network}?`,
      502,
    )
  }

  return { bridgeId: id, containerId }
}

export async function closeBridge(client: DockerClient, snapshot: Snapshot, bridgeId: string): Promise<void> {
  const container = snapshot.containers.find(
    (item) => item.gatewayComponent === 'access-bridge' && item.labels[LABELS.accessId] === bridgeId,
  )
  if (!container) throw new AccessError(`no bridge with id '${bridgeId}'`, '', 404)

  // Ownership is re-checked here rather than trusted from the lookup: this is
  // a code path that removes a container.
  if (container.labels[LABELS.managed] !== 'true') {
    throw new AccessError('refusing to remove a container the gateway does not own', '', 403)
  }
  await client.remove(container.id, true)
}
