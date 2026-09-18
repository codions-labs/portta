// What the panel is allowed to do to a container, and to which container.
//
// Two rules run through everything here:
//   - the panel never manages the gateway's own containers by accident: those
//     are reached through /api/gateway and /api/access, which know what they
//     are doing;
//   - a removal takes the container and nothing else. No volume, no network,
//     no image, no sibling in the same Compose project.

import type {
  ContainerSummary,
  EnvironmentActionEntry,
  EnvironmentActionResult,
  EnvironmentStartable,
  RemovalPreview,
} from 'portta-contracts'
import { orderProjectServices, parseDependsOn } from 'portta-core'
import type { DockerClient } from './docker/client.ts'
import type { Snapshot } from './inventory.ts'
import { LABELS } from './labels.ts'

export type ContainerAction = 'start' | 'stop' | 'restart'

export class ActionRefused extends Error {
  status: number
  hint: string
  constructor(message: string, hint = '', status = 403) {
    super(message)
    this.name = 'ActionRefused'
    this.hint = hint
    this.status = status
  }
}

export function findContainer(snapshot: Snapshot, id: string): ContainerSummary {
  const container =
    snapshot.containers.find((item) => item.id === id) ??
    snapshot.containers.find((item) => item.id.startsWith(id)) ??
    snapshot.containers.find((item) => item.name === id)
  if (!container) {
    throw new ActionRefused(`no container '${id}' on this host`, 'it may have been removed already', 404)
  }
  return container
}

export function assertNotGatewayOwned(container: ContainerSummary, verb: string): void {
  if (container.ownership !== 'gateway') return
  if (container.gatewayComponent === 'access-bridge') {
    throw new ActionRefused(
      `${container.name} is a TCP access bridge`,
      'close it from the Access page, which removes it cleanly',
    )
  }
  if (container.gatewayComponent === 'access-forwarder') {
    throw new ActionRefused(
      `${container.name} is a published TCP forwarder`,
      `remove it with: portta service unpublish ${container.labels['portta.forward.alias'] ?? ''}`.trim(),
    )
  }
  throw new ActionRefused(
    `refusing to ${verb} ${container.name}: it is a Portta component`,
    'gateway components are restarted from the Gateway page, or with portta restart',
  )
}

export async function runContainerAction(
  client: DockerClient,
  snapshot: Snapshot,
  id: string,
  action: ContainerAction,
): Promise<ContainerSummary> {
  const container = findContainer(snapshot, id)
  assertNotGatewayOwned(container, action)

  if (action === 'start' && container.state === 'running') {
    throw new ActionRefused(`${container.name} is already running`, '', 409)
  }
  if (action === 'stop' && container.state !== 'running' && container.state !== 'restarting') {
    throw new ActionRefused(`${container.name} is not running`, '', 409)
  }

  if (action === 'start') await client.start(container.id)
  else if (action === 'stop') await client.stop(container.id)
  else await client.restart(container.id)

  return container
}

export const CONTAINERS_GONE_REASON =
  "this project's containers are gone; start them with the runner (PORTTA_RUNNER=true) or docker compose up in the working directory"

export function projectStartable(services: ContainerSummary[]): EnvironmentStartable {
  if (services.length === 0) {
    return { ok: false, reason: CONTAINERS_GONE_REASON, via: 'runner' }
  }
  if (services.every((service) => service.state === 'running')) {
    return { ok: false, reason: 'every service is already running', via: null }
  }
  return { ok: true, reason: null, via: 'iteration' }
}

function asOrderable(container: ContainerSummary) {
  return {
    service: container.service ?? container.name,
    name: container.name,
    dependsOn: parseDependsOn(container.labels[LABELS.composeDependsOn]),
    container,
  }
}

async function runOne(
  client: DockerClient,
  container: ContainerSummary,
  action: 'start' | 'stop',
  state: Map<string, ContainerSummary['state']>,
): Promise<EnvironmentActionEntry> {
  const service = container.service ?? container.name
  const current = state.get(container.id) ?? container.state
  const skip =
    (action === 'start' && current === 'running') ||
    (action === 'stop' && current !== 'running' && current !== 'restarting')
  if (skip) {
    return { service, containerId: container.id, action, ok: true, skipped: true, error: null }
  }
  try {
    if (action === 'start') await client.start(container.id)
    else await client.stop(container.id)
    state.set(container.id, action === 'start' ? 'running' : 'exited')
    return { service, containerId: container.id, action, ok: true, skipped: false, error: null }
  } catch (error) {
    return {
      service,
      containerId: container.id,
      action,
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runProjectAction(
  client: DockerClient,
  snapshot: Snapshot,
  name: string,
  action: ContainerAction,
): Promise<EnvironmentActionResult> {
  // A `compose run` container is not a service: starting the environment
  // must not rerun a finished `composer install`.
  const members = snapshot.containers.filter((container) => container.environment === name && !container.oneOff)
  if (members.length === 0) {
    throw new ActionRefused(`no project '${name}' is running`, CONTAINERS_GONE_REASON, 404)
  }

  const gateway = members.find((container) => container.ownership === 'gateway')
  if (gateway) assertNotGatewayOwned(gateway, action)

  const stopOrder = orderProjectServices(members.map(asOrderable), 'stop').map((entry) => entry.container)
  const startOrder = orderProjectServices(members.map(asOrderable), 'start').map((entry) => entry.container)

  const state = new Map(members.map((container) => [container.id, container.state]))
  const results: EnvironmentActionEntry[] = []
  if (action === 'stop' || action === 'restart') {
    for (const container of stopOrder) results.push(await runOne(client, container, 'stop', state))
  }
  if (action === 'start' || action === 'restart') {
    for (const container of startOrder) results.push(await runOne(client, container, 'start', state))
  }

  const succeeded = results.filter((entry) => entry.ok && !entry.skipped).length
  const skipped = results.filter((entry) => entry.skipped).length
  const failed = results.filter((entry) => !entry.ok).length
  return {
    ok: failed === 0,
    project: name,
    action,
    requested: results.length,
    succeeded,
    failed,
    skipped,
    results,
  }
}

export function removalPreview(snapshot: Snapshot, id: string): RemovalPreview {
  const container = findContainer(snapshot, id)
  const namedVolumes = container.mounts
    .filter((mount) => mount.type === 'volume' && mount.name)
    .map((mount) => mount.name as string)
  const binds = container.mounts.filter((mount) => mount.type === 'bind')

  const warnings: string[] = []
  let allowed = true

  if (container.ownership === 'gateway') {
    allowed = false
    warnings.push('this is a Portta component; the panel does not remove its own infrastructure')
  }
  if (container.state === 'running') {
    warnings.push('the container is running and will be stopped first')
  }
  if (namedVolumes.length > 0) {
    warnings.push(`${namedVolumes.length} named volume(s) stay on the host: ${namedVolumes.join(', ')}`)
  }
  if (binds.length > 0) {
    warnings.push(`${binds.length} bind mount(s) point at the host and are never touched`)
  }
  if (container.environment) {
    warnings.push(
      `belongs to the Compose project "${container.environment}"; running docker compose up there recreates it`,
    )
  }
  if (container.networks.length > 0) {
    warnings.push(`networks are kept: ${container.networks.join(', ')}`)
  }

  return {
    containerId: container.id,
    name: container.name,
    image: container.image,
    ownership: container.ownership,
    state: container.state,
    project: container.environment,
    mounts: container.mounts,
    namedVolumes,
    networks: container.networks,
    warnings,
    allowed,
  }
}

export async function removeContainer(
  client: DockerClient,
  snapshot: Snapshot,
  id: string,
  options: { force: boolean },
): Promise<ContainerSummary> {
  const container = findContainer(snapshot, id)
  assertNotGatewayOwned(container, 'remove')

  if (container.state === 'running' && !options.force) {
    throw new ActionRefused(`${container.name} is running`, 'stop it first, or confirm the removal explicitly', 409)
  }

  // `remove` in the client hard-codes v=0 and link=0: volumes and networks
  // outlive the container, always.
  await client.remove(container.id, container.state === 'running')
  return container
}
