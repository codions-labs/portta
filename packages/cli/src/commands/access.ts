import { randomBytes } from 'node:crypto'
import type { Command } from 'commander'
import { BRIDGE_IMAGE, defaultPortForImage, isTrue, serviceKind, slug } from 'portta-core'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { ensureNetwork, inspectContainers, isManagedContainer } from '../docker.js'
import { RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}
function kindAndPort(image: string): { kind: string; port: number | null } {
  return { kind: serviceKind(image), port: defaultPortForImage(image) }
}
function duration(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value)
  if (!match) throw new UsageError(`invalid duration: ${value}; use 30m, 2h, 90s or seconds`)
  return Number(match[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]!] ?? 1)
}

function bridgeRecords(containers: Awaited<ReturnType<typeof inspectContainers>>) {
  return containers
    .filter((container) => container.labels['portta.component'] === 'access-bridge')
    .map((container) => {
      const binding = container.ports.find((port) => port.publicPort !== null)
      return {
        containerId: container.id,
        container: container.name,
        state: container.state,
        id: container.labels['portta.access.id'] ?? '',
        project: container.labels['portta.access.project'] ?? '',
        service: container.labels['portta.access.service'] ?? '',
        targetPort: Number(container.labels['portta.access.port'] ?? 0),
        localPort: binding?.publicPort ?? null,
        bind: binding?.ip ?? '',
        kind: container.labels['portta.access.kind'] ?? 'tcp',
        network: container.labels['portta.access.network'] ?? '',
        created: Number(container.labels['portta.access.created'] ?? 0),
        expires: container.labels['portta.access.expires'] ? Number(container.labels['portta.access.expires']) : null,
        managed: isTrue(container.labels['portta.managed']),
      }
    })
}

function bridgeJson(bridge: ReturnType<typeof bridgeRecords>[number]) {
  return {
    id: bridge.id,
    project: bridge.project,
    service: bridge.service,
    target_port: String(bridge.targetPort),
    local_port: bridge.localPort === null ? '' : String(bridge.localPort),
    kind: bridge.kind,
    expires: bridge.expires === null ? '' : String(bridge.expires),
    bind: bridge.bind,
    network: bridge.network,
    state: bridge.state,
  }
}

export async function accessList(command: Command): Promise<void> {
  const output = new Output(globals(command))
  const bridges = bridgeRecords(await inspectContainers())
  if (output.json) output.data({ bridges: bridges.map(bridgeJson) })
  else if (!bridges.length) output.progress('no bridges are open')
  else
    for (const bridge of bridges)
      output.line(
        `${bridge.id}\t${bridge.project}\t${bridge.service}\t${bridge.bind}:${bridge.localPort ?? '-'}\t${bridge.expires ?? '-'}`,
      )
}

export interface AccessOpenOptions {
  project: string
  service: string
  port?: string
  localPort?: string
  ttl?: string
  network?: string
  bind?: string
}
export async function accessOpen(options: AccessOpenOptions, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const output = new Output(global)
  const containers = await inspectContainers(false)
  const target = containers.find(
    (container) =>
      container.labels['com.docker.compose.project'] === options.project &&
      container.labels['com.docker.compose.service'] === options.service,
  )
  if (!target) throw new UsageError(`no running container for ${options.project}/${options.service}`)
  const existing = bridgeRecords(containers).find(
    (bridge) => bridge.project === options.project && bridge.service === options.service,
  )
  if (existing) {
    output.data(output.json ? bridgeJson(existing) : existing)
    return
  }
  const detected = kindAndPort(target.image)
  const declared = [...new Set(target.ports.map((port) => port.privatePort).filter(Boolean))]
  const port = options.port ? Number(options.port) : declared.length === 1 ? declared[0]! : detected.port
  if (!port || port < 1 || port > 65535)
    throw new UsageError(`cannot determine the target port for ${options.project}/${options.service}`, 'pass --port')
  const privateNetworks = target.networks.filter(
    (name) => ![context.config.network, context.config.controlNetwork, context.config.accessNetwork].includes(name),
  )
  const network =
    options.network ??
    (privateNetworks.includes(`${options.project}_default`)
      ? `${options.project}_default`
      : privateNetworks.length === 1
        ? privateNetworks[0]
        : undefined)
  if (!network)
    throw new RefusedError(`${options.project}/${options.service} has no unambiguous private network`, 'pass --network')
  const bind = options.bind ?? '127.0.0.1'
  if (!['127.0.0.1', 'localhost', '::1'].includes(bind))
    await confirm(
      `binding ${options.project}/${options.service} to ${bind} exposes it beyond this machine; continue?`,
      global.yes === true,
    )
  const id = randomBytes(3).toString('hex')
  const name = `portta-access-${slug(options.project)}-${slug(options.service)}-${id}`
  const ttl = options.ttl ? duration(options.ttl) : null
  const created = Math.floor(Date.now() / 1000)
  const labels = [
    'portta.managed=true',
    'portta.component=access-bridge',
    `portta.access.id=${id}`,
    `portta.access.project=${options.project}`,
    `portta.access.service=${options.service}`,
    `portta.access.port=${port}`,
    `portta.access.network=${network}`,
    `portta.access.kind=${detected.kind}`,
    `portta.access.created=${created}`,
    'traefik.enable=false',
    ...(ttl ? [`portta.access.expires=${created + ttl}`] : []),
  ]
  const args = [
    'run',
    '--detach',
    '--name',
    name,
    '--network',
    network,
    '--publish',
    `${bind}:${options.localPort ?? ''}:${port}`,
    '--restart',
    'no',
  ]
  for (const label of labels) args.push('--label', label)
  if (ttl)
    args.push(
      '--entrypoint',
      'timeout',
      BRIDGE_IMAGE,
      '-s',
      'TERM',
      String(ttl),
      'socat',
      `TCP-LISTEN:${port},fork,reuseaddr`,
      `TCP:${options.service}:${port}`,
    )
  else args.push(BRIDGE_IMAGE, `TCP-LISTEN:${port},fork,reuseaddr`, `TCP:${options.service}:${port}`)
  await runProcess('docker', args)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const bridge = bridgeRecords(await inspectContainers()).find((candidate) => candidate.id === id)
  if (bridge?.state !== 'running') {
    if (await isManagedContainer(name)) await runProcess('docker', ['rm', '-f', name], { reject: false })
    throw new RefusedError(
      'the bridge exited immediately',
      `check that ${options.service}:${port} is reachable on ${network}`,
    )
  }
  if (output.json) output.data(bridgeJson(bridge))
  else output.line(`${bridge.bind}:${bridge.localPort}`)
}

export async function accessClose(
  id: string | undefined,
  options: { project?: string; all?: boolean },
  command: Command,
): Promise<void> {
  const bridges = bridgeRecords(await inspectContainers()).filter(
    (bridge) => options.all || (options.project ? bridge.project === options.project : bridge.id === id),
  )
  if (!id && !options.project && !options.all) throw new UsageError('give a bridge id, --project, or --all')
  let removed = 0
  for (const bridge of bridges) {
    if (!bridge.managed || !bridge.id || !(await isManagedContainer(bridge.containerId))) continue
    const result = await runProcess('docker', ['rm', '-f', bridge.containerId], { reject: false })
    if (result.exitCode === 0) removed++
  }
  new Output(globals(command)).progress(`closed ${removed} bridge(s); services were not touched`)
}

export async function accessInspect(id: string, command: Command): Promise<void> {
  const bridge = bridgeRecords(await inspectContainers()).find((candidate) => candidate.id === id)
  if (!bridge) throw new UsageError(`no open bridge with id ${id}`)
  const output = new Output(globals(command))
  output.data(output.json ? bridgeJson(bridge) : bridge)
}

export async function accessGc(command: Command): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const containers = await inspectContainers()
  const liveTargets = new Set(
    containers
      .filter((container) => container.state === 'running')
      .map(
        (container) =>
          `${container.labels['com.docker.compose.project']}/${container.labels['com.docker.compose.service']}`,
      ),
  )
  const stale = bridgeRecords(containers).filter(
    (bridge) =>
      bridge.managed &&
      (bridge.state !== 'running' ||
        (bridge.expires !== null && bridge.expires <= now) ||
        !liveTargets.has(`${bridge.project}/${bridge.service}`)),
  )
  let removed = 0
  for (const bridge of stale)
    if (await isManagedContainer(bridge.containerId)) {
      const result = await runProcess('docker', ['rm', '-f', bridge.containerId], { reject: false })
      if (result.exitCode === 0) removed++
    }
  new Output(globals(command)).progress(removed ? `removed ${removed} stale bridge(s)` : 'nothing to collect')
}

export interface PublishOptions {
  private?: boolean
  public?: boolean
  project: string
  service: string
  port?: string
  alias?: string
}
export async function servicePublish(options: PublishOptions, command: Command): Promise<void> {
  if (options.public)
    throw new RefusedError('public TCP publishing is refused; databases, caches and queues belong on a private network')
  if (!options.private) throw new UsageError('--private is required')
  const context = gatewayContext({ profile: globals(command).profile })
  const containers = await inspectContainers(false)
  const target = containers.find(
    (container) =>
      container.labels['com.docker.compose.project'] === options.project &&
      container.labels['com.docker.compose.service'] === options.service,
  )
  if (!target) throw new UsageError(`no running container for ${options.project}/${options.service}`)
  const detected = kindAndPort(target.image)
  const port = options.port ? Number(options.port) : (detected.port ?? target.ports[0]?.privatePort)
  if (!port) throw new UsageError('cannot determine which port to forward', 'pass --port')
  const network =
    target.networks.find((name) => name === `${options.project}_default`) ??
    target.networks.find(
      (name) => ![context.config.network, context.config.accessNetwork, context.config.controlNetwork].includes(name),
    )
  if (!network) throw new RefusedError(`${options.project}/${options.service} is not on a private network`)
  const alias = slug(options.alias ?? `${options.project}-${options.service}`)
  await ensureNetwork(context.config.accessNetwork)
  const name = `portta-forward-${alias}`
  if (containers.some((container) => container.name === name))
    throw new RefusedError(`a forwarder named ${alias} already exists`)
  const args = ['run', '-d', '--name', name, '--network', network, '--restart', 'unless-stopped']
  for (const label of [
    'portta.managed=true',
    'portta.component=access-forwarder',
    `portta.forward.alias=${alias}`,
    `portta.forward.project=${options.project}`,
    `portta.forward.service=${options.service}`,
    `portta.forward.port=${port}`,
    `portta.forward.kind=${detected.kind}`,
    'traefik.enable=false',
  ])
    args.push('--label', label)
  args.push(BRIDGE_IMAGE, `TCP-LISTEN:${port},fork,reuseaddr`, `TCP:${options.service}:${port}`)
  await runProcess('docker', args)
  const connected = await runProcess(
    'docker',
    ['network', 'connect', '--alias', alias, context.config.accessNetwork, name],
    { reject: false },
  )
  if (connected.exitCode !== 0) {
    if (await isManagedContainer(name)) await runProcess('docker', ['rm', '-f', name], { reject: false })
    throw new RefusedError(`could not attach ${alias} to ${context.config.accessNetwork}`)
  }
  new Output(globals(command)).data({
    alias,
    project: options.project,
    service: options.service,
    port,
    network,
    accessNetwork: context.config.accessNetwork,
  })
}

export async function serviceList(command: Command): Promise<void> {
  const forwarders = (await inspectContainers())
    .filter((container) => container.labels['portta.component'] === 'access-forwarder')
    .map((container) => ({
      alias: container.labels['portta.forward.alias'],
      project: container.labels['portta.forward.project'],
      service: container.labels['portta.forward.service'],
      port: Number(container.labels['portta.forward.port']),
      state: container.state,
    }))
  const output = new Output(globals(command))
  if (output.json) output.data({ forwarders })
  else
    for (const item of forwarders)
      output.line(`${item.alias}\t${item.project}\t${item.service}\t${item.port}\t${item.state}`)
}

export async function serviceUnpublish(
  alias: string | undefined,
  options: { project?: string },
  command: Command,
): Promise<void> {
  if (!alias && !options.project) throw new UsageError('give an alias or --project')
  const targets = (await inspectContainers()).filter(
    (container) =>
      container.labels['portta.component'] === 'access-forwarder' &&
      (options.project
        ? container.labels['portta.forward.project'] === options.project
        : container.labels['portta.forward.alias'] === alias),
  )
  let removed = 0
  for (const target of targets)
    if (await isManagedContainer(target.id)) {
      const result = await runProcess('docker', ['rm', '-f', target.id], { reject: false })
      if (result.exitCode === 0) removed++
    }
  new Output(globals(command)).progress(`unpublished ${removed} forwarder(s); target services keep running`)
}
