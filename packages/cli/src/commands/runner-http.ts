// The runner projects API-owned intent. It never edits source Compose, adopts
// the project again, builds an image, or recreates an unrelated service.
import {
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  assertRunnerPath,
  composeFilesFromLabel,
  HTTP_ACCESS_FILE,
  type HttpAccessOperation,
  httpAccessOperationPath,
  httpAccessOverlayPath,
  httpPortHint,
  isTrue,
  parseRunnerRequest,
  type RunnerRequest,
  readHttpAccessStore,
  readTraefikLabels,
  routingGateStatus,
  runnerRefusal,
  traefikEnabled,
} from 'portta-core'
import { type GatewayContext, gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { RefusedError } from '../errors.js'
import { runProcess } from '../process.js'

export interface HttpComposition {
  project: string
  workingDir: string
  files: string[]
  profiles?: string[]
}

interface ComposeService {
  networks?: Record<string, unknown>
  labels?: Record<string, string>
  network_mode?: string
}
interface ComposeModel {
  services: Record<string, ComposeService>
  networks?: Record<string, { name?: string; external?: boolean }>
}

function atomicWrite(path: string, content: string, mode = 0o600, owner?: { uid: number; gid: number }): void {
  const directory = dirname(path)
  const created = mkdirSync(directory, { recursive: true, mode: mode === 0o644 ? 0o755 : 0o700 })
  // The runner is root, while both the panel and the host CLI use the
  // installation's UID. Only these generated paths receive the intent owner's
  // identity; existing parent directories keep the operator's permissions.
  if (owner && process.getuid?.() === 0) {
    let current = created ?? directory
    for (;;) {
      chownSync(current, owner.uid, owner.gid)
      if (current === directory) break
      const next = directory.slice(current.length + 1).split('/')[0]!
      current = join(current, next)
    }
  }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content, { mode, flag: 'wx' })
  if (owner && process.getuid?.() === 0) chownSync(temporary, owner.uid, owner.gid)
  try {
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function writeProjection(context: GatewayContext, path: string, content: string): void {
  const owner = statSync(join(context.root, HTTP_ACCESS_FILE))
  atomicWrite(path, content, 0o600, owner)
}

function argumentsFor(composition: HttpComposition, overlay?: string | null): string[] {
  return [
    'compose',
    '-p',
    composition.project,
    '--project-directory',
    composition.workingDir,
    ...composition.files.flatMap((file) => ['-f', file]),
    ...(overlay ? ['-f', overlay] : []),
    ...(composition.profiles ?? []).flatMap((profile) => ['--profile', profile]),
  ]
}

function withoutAttachment(context: GatewayContext, composition: HttpComposition): HttpComposition {
  const own = httpAccessOverlayPath(context.root, composition.project)
  return { ...composition, files: [...new Set(composition.files.filter((file) => resolve(file) !== own))] }
}

/** Refresh after source/runtime changes, and append this file LAST in every Compose entrypoint. */
export async function refreshHttpAccessOverlay(
  context: GatewayContext,
  input: HttpComposition,
): Promise<string | null> {
  const composition = withoutAttachment(context, input)
  const path = httpAccessOverlayPath(context.root, composition.project)
  const attachments = readHttpAccessStore(join(context.root, HTTP_ACCESS_FILE)).attachments.filter(
    (attachment) => attachment.project === composition.project,
  )
  if (!attachments.length) {
    rmSync(path, { force: true })
    return null
  }
  const configured = await runProcess('docker', [...argumentsFor(composition), 'config', '--format', 'json'], {
    cwd: composition.workingDir,
    reject: false,
  })
  if (configured.exitCode !== 0)
    throw new RefusedError('cannot resolve HTTP attachment Compose inputs', configured.stderr.trim())
  const model = JSON.parse(configured.stdout) as ComposeModel
  const key =
    Object.entries(model.networks ?? {}).find(([, network]) => network.name === context.config.network)?.[0] ??
    'portta_http_access'
  const declaration = model.networks?.[key]
  if (declaration && declaration.name !== context.config.network)
    throw new RefusedError(`network ${key} is already used by the project`)
  const live = context.config.profile === 'remote-public' ? await inspectContainers() : []
  const blocks = attachments.flatMap(({ service }) => {
    const source = model.services[service]
    // An old decision for a service removed from source never resurrects it.
    if (!source) return []
    if (source.network_mode) throw new RefusedError(`${service} uses network_mode and cannot join the gateway network`)
    const ownKey =
      Object.keys(source.networks ?? {}).find((name) => model.networks?.[name]?.name === context.config.network) ?? key
    const networks = {
      ...(Object.keys(source.networks ?? {}).length ? source.networks : { default: null }),
      [ownKey]: source.networks?.[ownKey] ?? null,
    }
    const inherited =
      live.find(
        (container) =>
          container.labels['com.docker.compose.project'] === composition.project &&
          container.labels['com.docker.compose.service'] === service,
      )?.labels ?? {}
    const labels = { ...inherited, ...source.labels }
    const enabled = traefikEnabled(source.labels ?? {})
    if (enabled && context.config.profile === 'remote-public' && routingGateStatus(labels) === 'ungated')
      throw new RefusedError(`${service} declares an ungated router; it cannot be attached on a public host`)
    const off = enabled ? '' : '    labels:\n      traefik.enable: "false"\n'
    return [
      `  ${JSON.stringify(service)}:\n    ports: !reset []\n    networks: !override ${JSON.stringify(networks)}\n${off}`,
    ]
  })
  if (!blocks.length) {
    rmSync(path, { force: true })
    return null
  }
  const networkBlock = declaration
    ? ''
    : `networks:\n  ${key}:\n    external: true\n    name: ${JSON.stringify(context.config.network)}\n`
  const content = `# Generated HTTP attachments. Source Compose files are immutable.\nservices:\n${blocks.join('')}${networkBlock}`
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null
  writeProjection(context, path, content)
  const validated = await runProcess('docker', [...argumentsFor(composition, path), 'config', '--quiet'], {
    cwd: composition.workingDir,
    reject: false,
  })
  if (validated.exitCode !== 0) {
    if (previous === null) rmSync(path, { force: true })
    else writeProjection(context, path, previous)
    throw new RefusedError('generated HTTP attachment is not valid Compose', validated.stderr.trim())
  }
  return path
}

function linkHostPath(root: string, path: string, hostRoot: string): void {
  if (path === root || path.startsWith(`${root}/`) || hostRoot === '/') return
  let partial = ''
  for (const segment of path.split('/').filter(Boolean)) {
    partial += `/${segment}`
    const hostPath = join(hostRoot, partial)
    if (!existsSync(partial)) {
      symlinkSync(hostPath, partial)
      return
    }
    if (lstatSync(partial).isSymbolicLink()) {
      if (realpathSync(partial) !== realpathSync(hostPath))
        throw new RefusedError(`${partial} in the runner does not refer to its host path`)
      return
    }
  }
  if (realpathSync(path) !== realpathSync(join(hostRoot, path)))
    throw new RefusedError(`${path} in the runner does not refer to its host path`)
}

async function labelledComposition(
  context: GatewayContext,
  request: RunnerRequest,
  hostRoot: string,
): Promise<HttpComposition> {
  const members = (await inspectContainers()).filter(
    (container) =>
      container.labels['com.docker.compose.project'] === request.project &&
      container.labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true',
  )
  if (
    request.project === context.config.projectName ||
    members.some((container) => container.labels['portta.managed'] === 'true')
  )
    throw new RefusedError('refusing to operate Portta components')
  const target =
    request.verb === 'integrate-http'
      ? members.find(
          (container) =>
            container.labels['com.docker.compose.service'] === request.service && container.state === 'running',
        )
      : members[0]
  if (!target && !(request.verb === 'up' && request.workingDir))
    throw new RefusedError('no running Compose service matches the HTTP integration request')
  if (request.verb === 'integrate-http') {
    if (!target) throw new RefusedError('no running Compose service matches the HTTP integration request')
    if (httpPortHint(target.image, request.port) === 'tcp') throw new RefusedError('this port does not serve HTTP')
    const declared = readTraefikLabels(target.labels)
    const labelledPort =
      !declared.ambiguous &&
      Object.entries(declared.labels).some(
        ([key, value]) =>
          key.startsWith('traefik.http.services.') &&
          key.endsWith('.loadbalancer.server.port') &&
          Number(value) === request.port,
      )
    if (!labelledPort && !target.ports.some((port) => port.privatePort === request.port && port.type === 'tcp'))
      throw new RefusedError('the selected TCP port is not exposed by this service')
  }
  const workingDir = assertRunnerPath(
    target?.labels['com.docker.compose.project.working_dir'] ?? request.workingDir ?? '',
    'working directory',
  )
  if (workingDir === context.root || workingDir.startsWith(`${context.root}/`))
    throw new RefusedError('refusing Portta working directory')
  if (!existsSync(join(hostRoot, workingDir)))
    throw new RefusedError('the Compose working directory is not on this host')
  linkHostPath(context.root, workingDir, hostRoot)
  const own = httpAccessOverlayPath(context.root, request.project)
  let files = (
    target
      ? composeFilesFromLabel(target.labels['com.docker.compose.project.config_files'])
      : (request.configFiles ?? [])
  ).filter((file) => resolve(file) !== own)
  if (!files.length)
    files = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
      .map((name) => join(workingDir, name))
      .filter((path) => existsSync(join(hostRoot, path)))
      .slice(0, 1)
  for (const file of files) {
    assertRunnerPath(file, 'Compose file')
    if (!existsSync(join(hostRoot, file))) throw new RefusedError(`Compose file ${file} is not on this host`)
    linkHostPath(context.root, dirname(file), hostRoot)
  }
  if (!files.length) throw new RefusedError('no Compose file was recorded for this service')
  return { project: request.project, workingDir, files }
}

function readRequest(context: GatewayContext): RunnerRequest {
  return parseRunnerRequest(JSON.parse(readFileSync(join(context.root, 'state/runner/request.json'), 'utf8')))
}

async function recreateSelected(
  context: GatewayContext,
  composition: HttpComposition,
  overlay: string | null,
  service: string,
): Promise<void> {
  const publicHost = context.config.profile === 'remote-public'
  const args = argumentsFor(composition, overlay)
  const created = await runProcess(
    'docker',
    [
      ...args,
      'up',
      '-d',
      ...(publicHost ? ['--no-start'] : []),
      '--no-deps',
      '--force-recreate',
      '--no-build',
      '--pull',
      'never',
      service,
    ],
    { cwd: composition.workingDir, reject: false, stdio: 'stream' },
  )
  if (created.exitCode !== 0)
    throw new RefusedError('selected service could not be recreated for HTTP access', created.stderr.trim())
  if (!publicHost) return
  // Image labels are absent from `compose config`. Inspect the actual created
  // containers while stopped, including after an image was changed locally.
  const selected = (await inspectContainers()).filter(
    (container) =>
      container.labels['com.docker.compose.project'] === composition.project &&
      container.labels['com.docker.compose.service'] === service &&
      container.labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true',
  )
  if (!selected.length || selected.some((container) => routingGateStatus(container.labels) === 'ungated'))
    throw new RefusedError('the recreated service has an ungated router and remains stopped')
  const started = await runProcess('docker', [...args, 'start', service], {
    cwd: composition.workingDir,
    reject: false,
    stdio: 'stream',
  })
  if (started.exitCode !== 0) throw new RefusedError('the selected service could not be started', started.stderr.trim())
}

/** Fixed internal entrypoint. Arguments and paths come only from the typed runner request and Docker. */
export async function integrateHttpFromRunner(
  context = gatewayContext(),
  hostRoot = existsSync('/host') ? '/host' : '/',
): Promise<void> {
  const request = readRequest(context)
  if (request.verb !== 'integrate-http') throw new RefusedError('the runner request is not HTTP integration')
  const statusPath = httpAccessOperationPath(context.root, request.requestId)
  const status: HttpAccessOperation = {
    requestId: request.requestId,
    project: request.project,
    service: request.service,
    port: request.port,
    state: 'running',
    error: null,
  }
  // No credentials live here. The panel must read a result replaced by the root runner.
  atomicWrite(statusPath, `${JSON.stringify(status)}\n`, 0o644)
  const overlayPath = httpAccessOverlayPath(context.root, request.project)
  const previous = existsSync(overlayPath) ? readFileSync(overlayPath, 'utf8') : null
  let composition: HttpComposition | null = null
  let recreated = false
  try {
    const refused = runnerRefusal(context.env)
    if (!isTrue(context.env.PORTTA_RUNNER) || refused)
      throw new RefusedError(refused ?? 'the project runner is disabled')
    const intent = readHttpAccessStore(join(context.root, HTTP_ACCESS_FILE))
    if (!intent.attachments.some((item) => item.project === request.project && item.service === request.service))
      throw new RefusedError('HTTP attachment was not authorized in the API intent store')
    composition = await labelledComposition(context, request, hostRoot)
    const overlay = await refreshHttpAccessOverlay(context, composition)
    if (!overlay) throw new RefusedError('the HTTP attachment has no target in Compose')
    recreated = true
    await recreateSelected(context, composition, overlay, request.service)
    const ready = (await inspectContainers()).some(
      (container) =>
        container.labels['com.docker.compose.project'] === request.project &&
        container.labels['com.docker.compose.service'] === request.service &&
        container.state === 'running' &&
        container.networks.includes(context.config.network),
    )
    if (!ready) throw new RefusedError('the recreated service is not running on the gateway network')
    status.state = 'ok'
    atomicWrite(statusPath, `${JSON.stringify(status)}\n`, 0o644)
  } catch (error) {
    if (previous === null) rmSync(overlayPath, { force: true })
    else writeProjection(context, overlayPath, previous)
    let recovery = ''
    if (recreated && composition) {
      await recreateSelected(context, composition, previous === null ? null : overlayPath, request.service).catch(
        () => {
          recovery = '; restoring the selected service also failed'
        },
      )
    }
    status.state = 'failed'
    status.error = `${error instanceof Error ? error.message : String(error)}${recovery}`
    atomicWrite(statusPath, `${JSON.stringify(status)}\n`, 0o644)
    throw new RefusedError(status.error)
  }
}

/** The existing lifecycle runner also refreshes/appends attachments before every Compose command. */
export async function projectHttpOverlayFromRunner(
  context = gatewayContext(),
  hostRoot = existsSync('/host') ? '/host' : '/',
): Promise<void> {
  const request = readRequest(context)
  const intent = readHttpAccessStore(join(context.root, HTTP_ACCESS_FILE))
  if (!intent.attachments.some((item) => item.project === request.project)) {
    rmSync(httpAccessOverlayPath(context.root, request.project), { force: true })
    return
  }
  const composition = await labelledComposition(context, request, hostRoot)
  await refreshHttpAccessOverlay(context, composition)
}
