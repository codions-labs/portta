// What a Service row says, decided once: how a container becomes a row when
// the server has not answered with one, how endpoints group by scope, and
// what the runtime column reads.

import type { ContainerSummary, EndpointScope, Service, ServiceAccess, ServiceAccessEndpoint } from 'portta-contracts'
import { orderEndpoints } from './endpoints.ts'

/** Nearest first, the order a person tries them in. */
export const SCOPE_ORDER: EndpointScope[] = ['local', 'lan', 'private', 'protected', 'public', 'internal']

export function accessFromContainer(container: ContainerSummary): ServiceAccess {
  const running = container.state === 'running'
  if (container.kind === 'http') {
    const endpoints: ServiceAccessEndpoint[] = running
      ? orderEndpoints(container.urls).map((url) => ({
          provider: url.scope,
          url: url.url,
          scope: url.scope === 'vpn' ? 'private' : url.scope,
          usable: true,
          shareable: url.scope !== 'local',
          problem: null,
        }))
      : []
    const routed = container.traefikEnabled && container.onGatewayNetwork
    const problem = !running
      ? null
      : routed && endpoints.length === 0
        ? 'no-hostname'
        : !container.traefikEnabled
          ? 'not-routed'
          : !container.onGatewayNetwork
            ? 'off-network'
            : null
    return { kind: 'http', primary: endpoints[0] ?? null, endpoints, bridge: null, routed, problem }
  }
  if (container.exposedPorts.length === 0 && container.ports.length === 0) {
    return {
      kind: 'none',
      primary: null,
      endpoints: [],
      bridge: null,
      routed: false,
      problem: running ? 'no-port' : null,
    }
  }
  return { kind: 'tcp', primary: null, endpoints: [], bridge: null, routed: false, problem: null }
}

/**
 * A Service row from a container summary alone. This is the fallback for a
 * list that has containers but no `/services` answer: the same shape, with no
 * measurement and no datastore addresses, so a row never disappears because
 * one route is missing.
 */
export function serviceFromContainer(
  container: ContainerSummary,
  options: { hidden?: boolean; readOnly?: boolean } = {},
): Service {
  const running = container.state === 'running'
  const access = accessFromContainer(container)
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
    resources: null,
    actions: {
      start: writable && !running,
      stop: writable && running,
      restart: writable && running,
      logs: true,
      openAccess: writable && running && access.kind === 'tcp',
      share: writable && running && access.kind === 'http' && access.routed,
    },
    ...(container.overrides ? { overrides: container.overrides } : {}),
    hidden: options.hidden === true,
  }
}

/** Endpoints grouped by scope, in the order a person tries them. */
export function endpointsByScope(
  endpoints: readonly ServiceAccessEndpoint[],
): Array<{ scope: EndpointScope; endpoints: ServiceAccessEndpoint[] }> {
  return SCOPE_ORDER.map((scope) => ({
    scope,
    endpoints: endpoints.filter((endpoint) => endpoint.scope === scope),
  })).filter((group) => group.endpoints.length > 0)
}

/** The server phrases a problem; the fallback names a key. Both become one i18n key here. */
export function accessProblemKey(
  problem: string | null,
): 'noHostname' | 'notRouted' | 'offNetwork' | 'noPort' | 'other' | null {
  if (problem === null) return null
  if (problem === 'no-hostname' || /no hostname/.test(problem)) return 'noHostname'
  if (problem === 'not-routed' || /never enabled traefik/.test(problem)) return 'notRouted'
  if (problem === 'off-network' || /shared network/.test(problem)) return 'offNetwork'
  if (problem === 'no-port' || /no port/.test(problem)) return 'noPort'
  return 'other'
}

/** The environment's rows, or the fallback rows, honouring the overrides. */
export function serviceRowsFor(
  environment: { services: ContainerSummary[]; overrides?: { hiddenServices?: string[]; serviceOrder?: string[] } },
  served: Service[] | null,
  readOnly = false,
): Service[] {
  if (served) return served
  const hidden = new Set(environment.overrides?.hiddenServices ?? [])
  const order = environment.overrides?.serviceOrder ?? []
  const rank = (name: string) => {
    const index = order.indexOf(name)
    return index < 0 ? order.length : index
  }
  return environment.services
    .map((container) =>
      serviceFromContainer(container, { hidden: hidden.has(container.service ?? container.name), readOnly }),
    )
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}
