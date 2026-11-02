import type { ContainerRecord } from './inventory.ts'

const GATE = 'portta-forward-auth@file'
const ROUTER = /^traefik\.http\.routers\.([^.]+)\./

/**
 * Running containers whose HTTP routing would not pass through ForwardAuth.
 *
 * On a public host the gate is what keeps an undecided hostname closed, and it
 * is carried by the labels of the generated overlay. A container started before
 * the host went public, or by a Compose file Portta did not plan, routes with no
 * gate at all: with no router labels Traefik derives one itself, and a router
 * whose `middlewares` leaves the gate out is open. Gateway components are not
 * routed projects, and a datastore reached by TLS name has no HTTP router (the
 * TCP entrypoint is refused on a public host).
 *
 * A container that is restarting, paused or only created comes back routed, so
 * every state but a deliberate stop counts. Labels are compared the way
 * Traefik reads them: keys and `traefik.enable` regardless of case.
 */
const ENABLED = new Set(['1', 't', 'true'])
const STOPPED = new Set(['exited', 'dead', 'removing'])

export function ungatedContainers(containers: ContainerRecord[]): string[] {
  return containers
    .filter((container) => !STOPPED.has(container.state) && container.labels['portta.managed'] !== 'true')
    .map((container) => ({
      name: container.name,
      labels: Object.fromEntries(Object.entries(container.labels).map(([key, value]) => [key.toLowerCase(), value])),
    }))
    .filter((container) => ENABLED.has((container.labels['traefik.enable'] ?? '').trim().toLowerCase()))
    .filter((container) => {
      const labels = Object.entries(container.labels)
      const hasHttp = labels.some(([key]) => key.startsWith('traefik.http.'))
      const hasTcp = labels.some(([key]) => key.startsWith('traefik.tcp.'))
      if (hasTcp && !hasHttp) return false
      const routers = new Set(labels.map(([key]) => ROUTER.exec(key)?.[1]).filter((name) => name !== undefined))
      if (routers.size === 0 && !hasHttp && hasTcp) return false
      if (routers.size === 0) return true
      return [...routers].some((name) => {
        const middlewares = container.labels[`traefik.http.routers.${name}.middlewares`] ?? ''
        return !middlewares.split(',').some((entry) => entry.trim().toLowerCase() === GATE)
      })
    })
    .map((container) => container.name)
    .sort()
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * Whether this gateway's Traefik already answers on an address other than
 * loopback. Only then is a restart harmless to the services it routes: a
 * gateway bound to loopback, as the local profile is, would start answering the
 * network the moment the profile became public.
 */
export function gatewayAlreadyPublic(containers: ContainerRecord[]): boolean {
  return containers.some(
    (container) =>
      container.state === 'running' &&
      container.labels['portta.managed'] === 'true' &&
      container.labels['portta.component'] === 'traefik' &&
      container.ports.some((port) => port.publicPort !== null && !LOOPBACK.has(port.ip)),
  )
}
