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
 * routed projects, and a datastore reached by TLS name has no HTTP router.
 */
export function ungatedContainers(containers: ContainerRecord[]): string[] {
  return containers
    .filter((container) => container.state === 'running' && container.labels['portta.managed'] !== 'true')
    .filter((container) => container.labels['traefik.enable'] === 'true')
    .filter((container) => {
      const labels = Object.entries(container.labels)
      const hasHttp = labels.some(([key]) => key.startsWith('traefik.http.'))
      const hasTcp = labels.some(([key]) => key.startsWith('traefik.tcp.'))
      if (hasTcp && !hasHttp) return false
      const routers = new Set(labels.map(([key]) => ROUTER.exec(key)?.[1]).filter((name) => name !== undefined))
      if (routers.size === 0) return true
      return [...routers].some((name) => {
        const middlewares = container.labels[`traefik.http.routers.${name}.middlewares`] ?? ''
        return !middlewares.split(',').some((entry) => entry.trim() === GATE)
      })
    })
    .map((container) => container.name)
    .sort()
}
