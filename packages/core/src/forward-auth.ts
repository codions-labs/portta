import { httpRouterNames, readTraefikLabels, ruleHosts, tcpRouterNames, traefikEnabled } from './traefik-rules.ts'

const GATE = 'portta-forward-auth@file'
const PUBLIC_ENTRYPOINTS = new Set(['web', 'websecure'])
/** Portta's own router for a bare IP: a PathPrefix, on the port nothing else answers on. */
const PANEL_ROUTER = 'portta-panel'
const PANEL_ENTRYPOINT = 'panel'

function entrypointsOf(labels: Record<string, string>, router: string): string[] {
  return (labels[`${router}.entrypoints`] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

/** Leaving the list out can select every default entrypoint, the public ones included. */
function onPublicEntrypoints(labels: Record<string, string>, router: string): boolean {
  const entrypoints = entrypointsOf(labels, router)
  return entrypoints.length === 0 || entrypoints.some((entry) => PUBLIC_ENTRYPOINTS.has(entry))
}

function isPanelRouter(labels: Record<string, string>, name: string): boolean {
  if (name !== PANEL_ROUTER) return false
  const entrypoints = entrypointsOf(labels, `traefik.http.routers.${name}`)
  return entrypoints.length === 1 && entrypoints[0] === PANEL_ENTRYPOINT
}

/** TCP routers run before HTTP middleware. */
function tcpOnPublicEntrypoints(labels: Record<string, string>): boolean {
  const keys = Object.keys(labels)
  if (!keys.some((key) => key.startsWith('traefik.tcp.'))) return false
  const routers = tcpRouterNames(labels)
  return routers.length === 0 || routers.some((name) => onPublicEntrypoints(labels, `traefik.tcp.routers.${name}`))
}

function routerIsGated(labels: Record<string, string>, name: string): boolean {
  return (labels[`traefik.http.routers.${name}.middlewares`] ?? '')
    .split(',')
    .some((entry) => entry.trim().toLowerCase() === GATE)
}

export function routingGateStatus(source: Record<string, string>): 'disabled' | 'private-tcp' | 'gated' | 'ungated' {
  // Different casing does not make a distinct Traefik setting. Conflicting
  // values make the effective router ambiguous, so never claim enforcement.
  const { labels, ambiguous } = readTraefikLabels(source)
  if (ambiguous) return 'ungated'
  if (!traefikEnabled(labels)) return 'disabled'
  const keys = Object.keys(labels)
  const hasHttp = keys.some((key) => key.startsWith('traefik.http.'))
  const hasTcp = keys.some((key) => key.startsWith('traefik.tcp.'))
  if (tcpOnPublicEntrypoints(labels)) return 'ungated'
  if (hasTcp && !hasHttp) return 'private-tcp'
  const routers = httpRouterNames(labels)
  if (routers.length === 0) return 'ungated'
  return routers.every((name) => routerIsGated(labels, name)) ? 'gated' : 'ungated'
}

/** Every enabled HTTP router must enforce the gate, with no TCP bypass on its public entrypoints. */
export function hasForwardAuth(labels: Record<string, string>): boolean {
  return routingGateStatus(labels) === 'gated'
}

/**
 * Open with no login on names nobody can list: a router with a regexp or no Host,
 * a TCP router on the public entrypoints, or labels that contradict themselves.
 *
 * Such a router can win any address on the host, depending on rule length, so the
 * addresses beside it cannot be called protected. Any other entrypoint still counts:
 * it is open there, and nothing here knows how that port is bound. The one exception
 * is the panel's own router, which the gateway's overlay declares exactly this way.
 */
export function opensUnknownHosts(source: Record<string, string>): boolean {
  if (routingGateStatus(source) !== 'ungated') return false
  const { labels, ambiguous } = readTraefikLabels(source)
  if (ambiguous || tcpOnPublicEntrypoints(labels)) return true
  return httpRouterNames(labels).some((name) => {
    const rule = labels[`traefik.http.routers.${name}.rule`]?.trim()
    return (
      !routerIsGated(labels, name) && !isPanelRouter(labels, name) && Boolean(rule) && ruleHosts(rule as string).unknown
    )
  })
}
