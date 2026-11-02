import { isWildcardAddress } from './diagnostics.ts'
import { opensUnknownHosts, routingGateStatus } from './forward-auth.ts'
import type { ContainerRecord } from './inventory.ts'

/**
 * Running containers whose HTTP routing would not pass through ForwardAuth.
 *
 * On a public host the gate is what keeps an undecided hostname closed, and it
 * is carried by the labels of the generated overlay. A container started before
 * the host went public, or by a Compose file Portta did not plan, routes with no
 * gate at all: with no router labels Traefik derives one itself, and a router
 * whose `middlewares` leaves the gate out is open. Gateway components are not
 * routed projects. A TCP router is private only when it explicitly avoids the
 * public HTTP entrypoints: TCP routers take precedence over HTTP routers, and
 * an omitted entrypoint list can include every default entrypoint.
 *
 * A container that is restarting, paused or only created comes back routed, so
 * every state but a deliberate stop counts. Labels are compared the way
 * Traefik reads them: keys and `traefik.enable` regardless of case.
 */
const STOPPED = new Set(['exited', 'dead', 'removing'])

export function ungatedContainers(containers: ContainerRecord[]): string[] {
  return containers
    .filter((container) => !STOPPED.has(container.state) && container.labels['portta.managed'] !== 'true')
    .filter((container) => routingGateStatus(container.labels) === 'ungated')
    .map((container) => container.name)
    .sort()
}

/**
 * Containers answering with no login on names nobody can list.
 *
 * A router like that can win any address on the host, depending on rule length,
 * so this is read across every container, whichever project it belongs to or
 * none. The same exclusions apply: the panel's own public entrypoint is a bare
 * PathPrefix, on a port of its own.
 */
export function openCatchAllContainers<T extends Pick<ContainerRecord, 'state' | 'labels'>>(
  containers: readonly T[],
): T[] {
  return containers.filter(
    (container) =>
      !STOPPED.has(container.state) &&
      container.labels['portta.managed'] !== 'true' &&
      opensUnknownHosts(container.labels),
  )
}

/**
 * Whether this gateway's Traefik already answers every interface on its HTTP or
 * HTTPS port. Only then is a restart harmless to the services it routes. A
 * gateway bound to loopback, as the local profile is, or to one specific
 * address, such as a tailnet's, would answer the whole network the moment the
 * profile became public, so those do not count: failing closed means asking
 * for the fix rather than guessing the address is already public.
 */
export function gatewayAlreadyPublic(containers: ContainerRecord[]): boolean {
  return containers.some(
    (container) =>
      container.state === 'running' &&
      container.labels['portta.managed'] === 'true' &&
      container.labels['portta.component'] === 'traefik' &&
      container.ports.some(
        (port) =>
          port.publicPort !== null &&
          (port.privatePort === 80 || port.privatePort === 443) &&
          (port.ip === '' || isWildcardAddress(port.ip)),
      ),
  )
}
