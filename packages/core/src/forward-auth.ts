const GATE = 'portta-forward-auth@file'
const HTTP_ROUTER = /^traefik\.http\.routers\.([^.]+)\./
const TCP_ROUTER = /^traefik\.tcp\.routers\.([^.]+)\./
const PUBLIC_ENTRYPOINTS = new Set(['web', 'websecure'])
const ENABLED = new Set(['1', 't', 'true'])

export function routingGateStatus(source: Record<string, string>): 'disabled' | 'private-tcp' | 'gated' | 'ungated' {
  const labels: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    const normalized = key.toLowerCase()
    // Different casing does not make a distinct Traefik setting. Conflicting
    // values make the effective router ambiguous, so never claim enforcement.
    if (normalized.startsWith('traefik.') && normalized in labels && labels[normalized] !== value) return 'ungated'
    labels[normalized] = value
  }
  if (!ENABLED.has((labels['traefik.enable'] ?? '').trim().toLowerCase())) return 'disabled'
  const keys = Object.keys(labels)
  const hasHttp = keys.some((key) => key.startsWith('traefik.http.'))
  const hasTcp = keys.some((key) => key.startsWith('traefik.tcp.'))
  const tcpRouters = new Set(keys.map((key) => TCP_ROUTER.exec(key)?.[1]).filter((name) => name !== undefined))
  // TCP routers run before HTTP middleware. Missing entrypoints can select the
  // public defaults, even when Portta's optional datastore entrypoints are off.
  if (
    hasTcp &&
    (tcpRouters.size === 0 ||
      [...tcpRouters].some((name) => {
        const entrypoints = (labels[`traefik.tcp.routers.${name}.entrypoints`] ?? '')
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
        return entrypoints.length === 0 || entrypoints.some((entry) => PUBLIC_ENTRYPOINTS.has(entry))
      }))
  )
    return 'ungated'
  if (hasTcp && !hasHttp) return 'private-tcp'
  const routers = new Set(keys.map((key) => HTTP_ROUTER.exec(key)?.[1]).filter((name) => name !== undefined))
  if (routers.size === 0) return 'ungated'
  return [...routers].every((name) =>
    (labels[`traefik.http.routers.${name}.middlewares`] ?? '')
      .split(',')
      .some((entry) => entry.trim().toLowerCase() === GATE),
  )
    ? 'gated'
    : 'ungated'
}

/** Every enabled HTTP router must enforce the gate, with no TCP bypass on its public entrypoints. */
export function hasForwardAuth(labels: Record<string, string>): boolean {
  return routingGateStatus(labels) === 'gated'
}
