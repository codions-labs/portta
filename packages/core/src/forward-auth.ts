import { httpRouterNames, readTraefikLabels, ruleHosts, tcpRouterNames, traefikEnabled } from './traefik-rules.ts'

const GATE = 'portta-forward-auth@file'
const PUBLIC_ENTRYPOINTS = new Set(['web', 'websecure'])

/** TCP routers run before HTTP middleware, and missing entrypoints can select the public defaults. */
function tcpOnPublicEntrypoints(labels: Record<string, string>): boolean {
  const keys = Object.keys(labels)
  if (!keys.some((key) => key.startsWith('traefik.tcp.'))) return false
  const routers = tcpRouterNames(labels)
  return (
    routers.length === 0 ||
    routers.some((name) => {
      const entrypoints = (labels[`traefik.tcp.routers.${name}.entrypoints`] ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
      return entrypoints.length === 0 || entrypoints.some((entry) => PUBLIC_ENTRYPOINTS.has(entry))
    })
  )
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
 * addresses beside it cannot be called protected.
 */
export function opensUnknownHosts(source: Record<string, string>): boolean {
  if (routingGateStatus(source) !== 'ungated') return false
  const { labels, ambiguous } = readTraefikLabels(source)
  if (ambiguous || tcpOnPublicEntrypoints(labels)) return true
  return httpRouterNames(labels).some((name) => {
    const rule = labels[`traefik.http.routers.${name}.rule`]?.trim()
    return !routerIsGated(labels, name) && Boolean(rule) && ruleHosts(rule as string).unknown
  })
}
