// One Service row from what the panel already has: the container summary,
// the endpoints the access model derives, the collector's numbers and the
// overrides. Pure over its inputs so the rule for "what is the primary
// address" and "which actions apply" lives once.

import type {
  Bridge,
  ContainerSummary,
  EnvironmentServices,
  MetricsCurrent,
  RouteUrl,
  Service,
  ServiceAccess,
  ServiceAccessEndpoint,
  ServiceResources,
} from 'portta-contracts'
import { serviceKind } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { datastoreEndpoints } from './access.ts'

const SCOPE_ORDER: Record<string, number> = {
  local: 0,
  lan: 1,
  private: 2,
  vpn: 2,
  protected: 3,
  public: 4,
  internal: 5,
}

function scopeOf(url: RouteUrl): ServiceAccessEndpoint['scope'] {
  return url.scope === 'vpn' ? 'private' : url.scope
}

/** Routed URLs, local first, https before http, as access endpoints. */
export function httpEndpoints(urls: readonly RouteUrl[]): ServiceAccessEndpoint[] {
  return [...urls]
    .sort(
      (a, b) =>
        (SCOPE_ORDER[a.scope] ?? 9) - (SCOPE_ORDER[b.scope] ?? 9) ||
        (a.scheme === b.scheme ? 0 : a.scheme === 'https' ? -1 : 1) ||
        a.url.localeCompare(b.url),
    )
    .map((url) => ({
      provider: url.scope,
      url: url.url,
      scope: scopeOf(url),
      usable: true,
      shareable: url.scope !== 'local',
      problem: null,
    }))
}

export function accessFor(container: ContainerSummary, config: PanelConfig, bridge: Bridge | null): ServiceAccess {
  const running = container.state === 'running'
  const kind = serviceKind(container.image)
  if (container.kind === 'http') {
    const endpoints = running ? httpEndpoints(container.urls) : []
    const routed = container.traefikEnabled && container.onGatewayNetwork
    const problem = !running
      ? null
      : routed && endpoints.length === 0
        ? 'routing is enabled but no hostname was discovered'
        : !container.traefikEnabled
          ? 'not routed: the service never enabled traefik'
          : !container.onGatewayNetwork
            ? 'not routed: the service is not on the shared network'
            : null
    return { kind: 'http', primary: endpoints.find((e) => e.usable) ?? null, endpoints, bridge: null, routed, problem }
  }
  if (container.exposedPorts.length === 0 && container.ports.length === 0) {
    return {
      kind: 'none',
      primary: null,
      endpoints: [],
      bridge: null,
      routed: false,
      problem: running ? 'no port is exposed' : null,
    }
  }
  const endpoints = running
    ? datastoreEndpoints(container, kind, config, bridge)
        .filter((endpoint) => endpoint.provider !== 'internal')
        .map((endpoint) => ({
          provider: endpoint.provider,
          url: endpoint.url,
          scope: endpoint.scope,
          usable: endpoint.usable,
          shareable: endpoint.shareable,
          problem: endpoint.problem,
        }))
    : []
  const primary = endpoints.find((e) => e.provider === 'bridge') ?? endpoints.find((e) => e.usable) ?? null
  return { kind: 'tcp', primary, endpoints, bridge, routed: false, problem: null }
}

export function resourcesFor(
  metrics: MetricsCurrent,
  containerId: string,
  service: string | null,
  environment: string | null,
): ServiceResources | null {
  for (const project of metrics.projects) {
    if (environment && project.composeProject !== environment && project.id !== environment) continue
    const found = project.containers.find(
      (c) =>
        c.id === containerId ||
        c.id.startsWith(containerId) ||
        containerId.startsWith(c.id) ||
        (service !== null && c.service === service),
    )
    if (found) {
      return {
        cpuUtilisation: found.cpuUtilisation,
        memoryUsedBytes: found.memoryUsedBytes,
        memoryLimitBytes: found.memoryLimitBytes,
        diskBytes: null,
        collectedAt: metrics.collectedAt,
        stale: metrics.stale,
      }
    }
  }
  return null
}

export function serviceView(
  container: ContainerSummary,
  config: PanelConfig,
  metrics: MetricsCurrent,
  bridge: Bridge | null,
  options: { hidden?: boolean; readOnly?: boolean; publicAllowed?: boolean } = {},
): Service {
  const running = container.state === 'running'
  const access = accessFor(container, config, bridge)
  const writable = options.readOnly !== true
  return {
    name: container.service ?? container.name,
    environment: container.environment ?? '',
    containerId: container.id,
    containerName: container.name,
    image: container.image,
    kind: container.kind,
    tech: container.tech,
    state: container.state,
    health: container.health,
    startedAt: container.startedAt,
    uptimeSeconds: container.uptimeSeconds,
    restartCount: container.restartCount,
    exitCode: container.exitCode,
    completed: container.completed,
    ports: container.ports,
    exposedPorts: container.exposedPorts,
    networks: container.networks,
    onGatewayNetwork: container.onGatewayNetwork,
    access,
    resources: running ? resourcesFor(metrics, container.id, container.service, container.environment) : null,
    actions: {
      start: writable && !running,
      stop: writable && running,
      restart: writable && running,
      logs: true,
      openAccess: writable && running && access.kind === 'tcp' && bridge === null,
      share: writable && running && access.kind === 'http' && access.routed,
    },
    ...(container.overrides ? { overrides: container.overrides } : {}),
    hidden: options.hidden === true,
  }
}

export function environmentServices(
  environment: {
    name: string
    services: ContainerSummary[]
    overrides?: { hiddenServices?: string[]; serviceOrder?: string[] }
  },
  config: PanelConfig,
  metrics: MetricsCurrent,
  bridges: readonly Bridge[],
  options: { readOnly?: boolean } = {},
): EnvironmentServices {
  const hidden = new Set(environment.overrides?.hiddenServices ?? [])
  const order = environment.overrides?.serviceOrder ?? []
  const rank = (name: string) => {
    const index = order.indexOf(name)
    return index < 0 ? order.length : index
  }
  const services = environment.services
    .map((container) =>
      serviceView(
        container,
        config,
        metrics,
        bridges.find((bridge) => bridge.project === container.environment && bridge.service === container.service) ??
          null,
        { hidden: hidden.has(container.service ?? container.name), readOnly: options.readOnly },
      ),
    )
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  const measured = services.map((s) => s.resources).filter((r): r is ServiceResources => r !== null)
  const sum = (pick: (r: ServiceResources) => number | null) => {
    const values = measured.map(pick).filter((v): v is number => v !== null)
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0)
  }
  return {
    environment: environment.name,
    services,
    resources:
      measured.length === 0
        ? null
        : {
            cpuUtilisation: sum((r) => r.cpuUtilisation),
            memoryUsedBytes: sum((r) => r.memoryUsedBytes),
            memoryLimitBytes: sum((r) => r.memoryLimitBytes),
            diskBytes: null,
            collectedAt: metrics.collectedAt,
            stale: metrics.stale,
          },
  }
}
