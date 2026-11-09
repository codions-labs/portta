// Rebuild and remove a project from this host.
//
// Compose-shaped work goes through the runner (ADR 0030). The panel's Docker
// permissions stay start/stop/restart/remove-container. Nothing here imports
// the GitHub integration, talks to a remote, or concatenates a path into a
// shell. See issue #38.

import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  EnvironmentPorttaRecords,
  EnvironmentRemovalPreview,
  ProjectRebuildResult,
  ProjectRemoveResult,
  RunnerStatus,
} from 'portta-contracts'
import {
  parseRunnerRequest,
  type RunnerFlag,
  type RunnerRequest,
  type RunnerVerb,
  readHttpAccessStore,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { closeBridge, listBridges, listForwarders } from './access.ts'
import { ActionRefused } from './actions.ts'
import type { DockerClient } from './docker/client.ts'
import type { Snapshot } from './inventory.ts'
import { loadAliases, saveAliases } from './overrides.ts'
import { runnerOf, runnerStatus } from './runner.ts'

export function confirmProjectName(expected: string, confirmation: string): void {
  if (confirmation !== expected) {
    throw new ActionRefused(
      `confirmation does not match project '${expected}'`,
      'type the exact Compose project name',
      400,
    )
  }
}

function shellSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function membersOf(snapshot: Snapshot, name: string) {
  return snapshot.containers.filter((container) => container.environment === name)
}

function assertRemovableProject(snapshot: Snapshot, config: PanelConfig, name: string, verb: string) {
  if (name === config.projectName) {
    throw new ActionRefused(
      `refusing to ${verb} ${name}: it is Portta's own project`,
      'gateway components are restarted from the Gateway page, or with portta restart',
    )
  }
  const members = membersOf(snapshot, name)
  const gateway = members.find((container) => container.ownership === 'gateway')
  if (gateway) {
    throw new ActionRefused(
      `refusing to ${verb} ${gateway.name}: it is a Portta component`,
      'gateway components are restarted from the Gateway page, or with portta restart',
    )
  }
  return members
}

function projectOrThrow(snapshot: Snapshot, name: string) {
  const project = snapshot.environments.find((item) => item.name === name)
  if (!project) {
    throw new ActionRefused(`no project '${name}' is running`, 'it may have been removed already', 404)
  }
  return project
}

async function dbRecords(db: Database | null, name: string) {
  if (db === null || !db.status().available) {
    return { overrides: 0, projectLinks: 0 }
  }
  return db.environments.recordCounts(name)
}

function accessFilesFor(accessDir: string, project: string): string[] {
  const tunnels = join(accessDir, 'tunnels')
  let names: string[]
  try {
    names = readdirSync(tunnels)
  } catch {
    return []
  }
  const found: string[] = []
  const root = resolve(accessDir)
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    if (name.includes('..') || name.includes('/') || name.includes('\\')) continue
    const path = resolve(tunnels, name)
    if (!path.startsWith(`${root}/`)) continue
    try {
      const record = JSON.parse(readFileSync(path, 'utf8')) as { project?: unknown }
      if (record.project === project) found.push(path)
    } catch {
      // An unreadable record is not ours to delete.
    }
  }
  return found
}

function deleteAccessFiles(paths: string[], accessDir: string): string[] {
  const root = resolve(accessDir)
  const removed: string[] = []
  for (const path of paths) {
    const resolved = resolve(path)
    if (!resolved.startsWith(`${root}/`)) continue
    try {
      unlinkSync(resolved)
      removed.push(resolved)
    } catch {
      // Report the miss in the result by omitting it.
    }
  }
  return removed
}

export async function projectRemovalPreview(
  snapshot: Snapshot,
  config: PanelConfig,
  db: Database | null,
  name: string,
): Promise<EnvironmentRemovalPreview> {
  const project = projectOrThrow(snapshot, name)
  const members = assertRemovableProject(snapshot, config, name, 'preview')
  const volumes = new Map<string, null>()
  for (const container of members) {
    for (const mount of container.mounts) {
      if (mount.type === 'volume' && mount.name) volumes.set(mount.name, null)
    }
  }
  const runnerPresent = Boolean(runnerOf(snapshot))

  const records = await collectRecords(snapshot, config, db, name)
  return {
    environment: name,
    containers: members.map((container) => ({
      id: container.id,
      name: container.name,
      service: container.service,
      state: container.state,
      image: container.image,
    })),
    networks: [...project.networks],
    volumes: [...volumes.keys()].map((volumeName) => ({ name: volumeName, sizeBytes: null })),
    workingDir: project.workingDir,
    records,
    runnerAvailable: runnerPresent,
  }
}

async function collectRecords(
  snapshot: Snapshot,
  config: PanelConfig,
  db: Database | null,
  name: string,
): Promise<EnvironmentPorttaRecords> {
  const counts = await dbRecords(db, name)
  const aliases = loadAliases(config).filter((alias) => alias.project === name)
  return {
    overrides: counts.overrides,
    aliases: aliases.length,
    projectLinks: counts.projectLinks,
    accessBridges: listBridges(snapshot)
      .filter((bridge) => bridge.project === name)
      .map((bridge) => bridge.id),
    accessForwarders: listForwarders(snapshot)
      .filter((forwarder) => forwarder.project === name)
      .map((forwarder) => forwarder.alias),
    accessFiles: accessFilesFor(config.accessDir, name).map((path) => path.slice(resolve(config.accessDir).length + 1)),
  }
}

export function writeRunnerRequest(config: PanelConfig, request: RunnerRequest): string {
  const parsed = parseRunnerRequest(request)
  mkdirSync(config.runnerDir, { recursive: true, mode: 0o700 })
  const dest = join(config.runnerDir, 'request.json')
  writeFileSync(
    `${dest}.tmp`,
    `${JSON.stringify({
      verb: parsed.verb,
      project: parsed.project,
      flags: parsed.flags ?? [],
      ...(parsed.verb === 'integrate-http'
        ? { service: parsed.service, port: parsed.port, requestId: parsed.requestId }
        : {}),
      ...(parsed.workingDir === undefined
        ? {}
        : { workingDir: parsed.workingDir, configFiles: parsed.configFiles ?? [] }),
    })}\n`,
    { mode: 0o600 },
  )
  renameSync(`${dest}.tmp`, dest)
  return dest
}

const dispatching = new Set<string>()

export async function dispatchRunner(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  request: RunnerRequest,
): Promise<RunnerStatus> {
  if (dispatching.has(config.runnerDir))
    throw new ActionRefused('the runner is already being started', 'watch it rather than starting a second one', 409)
  dispatching.add(config.runnerDir)
  try {
    const status = await runnerStatus(client, snapshot, config)
    if (!status.available) {
      throw new ActionRefused(status.reason ?? 'the runner is unavailable', status.prepareCommand, 404)
    }
    if (status.state === 'running') {
      throw new ActionRefused('the runner is already running', 'watch it rather than starting a second one', 409)
    }
    writeRunnerRequest(config, request)
    const container = runnerOf(snapshot)
    if (!container) {
      throw new ActionRefused('the runner is unavailable', status.prepareCommand, 404)
    }
    await client.start(container.id)
    return await runnerStatus(client, snapshot, config, { logs: true })
  } finally {
    dispatching.delete(config.runnerDir)
  }
}

export async function rebuildProject(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  name: string,
  options: { noCache?: boolean } = {},
): Promise<ProjectRebuildResult> {
  const project = projectOrThrow(snapshot, name)
  assertRemovableProject(snapshot, config, name, 'rebuild')
  if (!project.operable.ok) {
    throw new ActionRefused(
      project.operable.reason ?? 'this project is not operable',
      'the runner needs a Compose working-directory label',
      409,
    )
  }
  const noCache = options.noCache === true
  const flags: RunnerFlag[] = noCache ? ['no-cache'] : []
  const runner = await dispatchRunner(client, snapshot, config, {
    verb: 'build',
    project: name,
    flags,
  })
  return { ok: true, project: name, noCache, via: 'runner', runner }
}

export async function removeProject(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  db: Database | null,
  name: string,
  body: { confirmation: string; volumes: boolean },
): Promise<ProjectRemoveResult> {
  confirmProjectName(name, body.confirmation)
  const project = projectOrThrow(snapshot, name)
  const members = assertRemovableProject(snapshot, config, name, 'remove')
  const mode = body.volumes ? 'and-local-data' : 'keep-data'
  const runner = runnerOf(snapshot)

  if (runner && !project.operable.ok) {
    throw new ActionRefused(
      project.operable.reason ?? 'this project is not operable',
      'without a working-directory label the runner cannot take the project down',
      409,
    )
  }

  if (runner) {
    const verb: RunnerVerb = body.volumes ? 'down-volumes' : 'down'
    const status = await dispatchRunner(client, snapshot, config, { verb, project: name })
    const cleaned = await cleanupPorttaRecords(client, snapshot, config, db, name, { forget: false })
    return {
      ok: true,
      project: name,
      mode,
      volumes: body.volumes,
      via: 'runner',
      removedContainers: members.map((container) => container.name),
      cleaned,
      remainingCommands: [],
      runner: status,
      note: 'The project directory and its repository are not touched.',
    }
  }

  const removedContainers: string[] = []
  for (const container of members) {
    try {
      await client.remove(container.id, container.state === 'running')
      removedContainers.push(container.name)
    } catch (error) {
      throw new ActionRefused(
        `could not remove ${container.name}: ${error instanceof Error ? error.message : String(error)}`,
        'the rest of the removal did not run',
        502,
      )
    }
  }

  const remainingCommands: string[] = []
  const dir = project.workingDir
  if (body.volumes) {
    remainingCommands.push(
      dir
        ? `docker compose --project-name ${name} --project-directory ${shellSingle(dir)} down --volumes`
        : `docker compose --project-name ${name} down --volumes`,
    )
  } else {
    remainingCommands.push(
      dir
        ? `docker compose --project-name ${name} --project-directory ${shellSingle(dir)} down`
        : `docker compose --project-name ${name} down`,
    )
  }
  // Without the runner the directory stays, so the environment stays remembered.
  const cleaned = await cleanupPorttaRecords(client, snapshot, config, db, name, { forget: false })
  return {
    ok: true,
    project: name,
    mode,
    volumes: body.volumes,
    via: 'iteration',
    removedContainers,
    cleaned,
    remainingCommands,
    runner: null,
    note: 'The project directory and its repository are not touched. The panel removed what it can; the printed commands finish the rest.',
  }
}

async function cleanupPorttaRecords(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  db: Database | null,
  name: string,
  options: { forget: boolean },
): Promise<EnvironmentPorttaRecords> {
  const before = await collectRecords(snapshot, config, db, name)

  for (const id of before.accessBridges) {
    try {
      await closeBridge(client, snapshot, id)
    } catch {
      // A vanished bridge is already gone.
    }
  }
  for (const alias of before.accessForwarders) {
    const forwarder = listForwarders(snapshot).find((item) => item.alias === alias)
    if (!forwarder) continue
    const container = snapshot.containers.find((item) => item.id === forwarder.containerId)
    if (container?.labels['portta.managed'] !== 'true') continue
    try {
      await client.remove(forwarder.containerId, true)
    } catch {
      // Same: already gone is success enough.
    }
  }

  const aliases = loadAliases(config).filter((alias) => alias.project !== name)
  saveAliases(config, aliases)

  const attachmentPath = join(config.runnerDir, 'http-access.json')
  const attachments = readHttpAccessStore(attachmentPath)
  if (attachments.attachments.some((attachment) => attachment.project === name)) {
    attachments.attachments = attachments.attachments.filter((attachment) => attachment.project !== name)
    writeFileSync(`${attachmentPath}.tmp`, `${JSON.stringify(attachments)}\n`, { mode: 0o600 })
    renameSync(`${attachmentPath}.tmp`, attachmentPath)
    // The asynchronous runner may still need the generated overlay to read
    // the container's recorded Compose files. Its inert projection can be
    // regenerated later; deleting it here could break the in-flight down.
  }

  deleteAccessFiles(accessFilesFor(config.accessDir, name), config.accessDir)

  // Taking the containers down leaves the environment remembered: the
  // working directory is still there and the panel can start it again
  // through the runner. Only removing the directory forgets it.
  if (options.forget && db?.status().available) {
    await db.environments.forget(name)
  }

  return before
}
