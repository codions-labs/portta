import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { RunnerStatus } from 'portta-contracts'
import { HttpIntegrationOperation, type HttpIntegrationResult } from 'portta-contracts'
import { type HttpAccessStore, readHttpAccessStore } from 'portta-core'
import type { AppDeps } from '../deps.ts'
import { ActionRefused } from './actions.ts'
import { dispatchRunner } from './operations.ts'
import { loadAliases, planAlias } from './overrides.ts'
import { runnerStatus } from './runner.ts'

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

const mutations = new Map<string, Promise<void>>()

async function serial<T>(key: string, change: () => Promise<T>): Promise<T> {
  const previous = mutations.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  mutations.set(key, current)
  await previous
  try {
    return await change()
  } finally {
    release()
    if (mutations.get(key) === current) mutations.delete(key)
  }
}

function operationPath(deps: AppDeps, requestId: string): string {
  // Validate before constructing a path, even when called without the HTTP route.
  HttpIntegrationOperation.shape.requestId.parse(requestId)
  return join(deps.config.runnerDir, 'http-operations', `${requestId}.json`)
}

function operations(deps: AppDeps): HttpIntegrationOperation[] {
  const directory = join(deps.config.runnerDir, 'http-operations')
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const parsed = HttpIntegrationOperation.safeParse(JSON.parse(readFileSync(join(directory, name), 'utf8')))
        return parsed.success ? [parsed.data] : []
      } catch {
        return []
      }
    })
}

function runningOperation(deps: AppDeps, operation: HttpIntegrationOperation, runner: RunnerStatus): boolean {
  let request: { requestId?: string; project?: string; service?: string }
  try {
    request = JSON.parse(readFileSync(join(deps.config.runnerDir, 'request.json'), 'utf8'))
  } catch {
    return false
  }
  if (
    request.requestId !== operation.requestId ||
    request.project !== operation.project ||
    request.service !== operation.service
  )
    return false
  if (runner.available && runner.state === 'running') return true
  // Docker can briefly report the pre-start state after accepting start.
  return (
    runner.available &&
    runner.state === 'idle' &&
    runner.startedAt === null &&
    Date.now() - statSync(operationPath(deps, operation.requestId)).mtimeMs < 5000
  )
}

export async function beginHttpIntegration(
  deps: AppDeps,
  request: { project: string; service: string; alias: string; port: number },
): Promise<HttpIntegrationResult> {
  return serial(deps.config.runnerDir, async () => {
    const snapshot = await deps.cache.get(true)
    planAlias(request, snapshot, loadAliases(deps.config), deps.config, { allowUnreachable: true })
    const environment = snapshot.environments.find((entry) => entry.name === request.project)!
    const container = environment.services.find((entry) => (entry.service ?? entry.name) === request.service)!
    if (container.ownership === 'gateway' || request.project === deps.config.projectName) {
      throw new ActionRefused('Portta components cannot be integrated as project web services')
    }
    if (container.onGatewayNetwork) return { ready: true, requestId: null }
    if (!environment.operable.ok) {
      throw new ActionRefused(
        environment.operable.reason ?? 'this environment has no Compose configuration',
        'integrate it from the host with portta first',
        409,
      )
    }
    const status = await runnerStatus(deps.client, snapshot, deps.config)
    if (!status.available)
      throw new ActionRefused(status.reason ?? 'the runner is unavailable', status.prepareCommand, 409)
    const outstanding = operations(deps).filter(
      (operation) => operation.state === 'pending' || operation.state === 'running',
    )
    const pending = outstanding.find((operation) => runningOperation(deps, operation, status))
    for (const stale of outstanding.filter((operation) => operation !== pending)) {
      writeJson(operationPath(deps, stale.requestId), {
        ...stale,
        state: 'failed',
        error: 'the runner no longer has this HTTP integration in progress',
      })
    }
    if (pending) {
      if (pending.project === request.project && pending.service === request.service && pending.port === request.port) {
        return { ready: false, requestId: pending.requestId }
      }
      throw new ActionRefused('an HTTP integration is already in progress', 'wait for it to finish', 409)
    }
    if (status.state === 'running')
      throw new ActionRefused('the runner is already running', 'wait for it to finish', 409)

    const intentPath = join(deps.config.runnerDir, 'http-access.json')
    const previous = readHttpAccessStore(intentPath)
    const added = !previous.attachments.some(
      (entry) => entry.project === request.project && entry.service === request.service,
    )
    const next: HttpAccessStore = {
      version: 1,
      attachments: [
        ...previous.attachments,
        ...(added ? [{ project: request.project, service: request.service }] : []),
      ],
    }
    const requestId = randomUUID()
    const operation: HttpIntegrationOperation = {
      requestId,
      project: request.project,
      service: request.service,
      port: request.port,
      state: 'pending',
      error: null,
    }
    writeJson(intentPath, next)
    try {
      writeJson(operationPath(deps, requestId), operation)
      await dispatchRunner(deps.client, snapshot, deps.config, {
        verb: 'integrate-http',
        project: request.project,
        service: request.service,
        port: request.port,
        requestId,
      })
    } catch (error) {
      if (added) {
        const current = readHttpAccessStore(intentPath)
        writeJson(intentPath, {
          ...current,
          attachments: current.attachments.filter(
            (entry) => entry.project !== request.project || entry.service !== request.service,
          ),
        })
      }
      writeJson(operationPath(deps, requestId), {
        ...operation,
        state: 'failed',
        error: 'the HTTP integration could not be started',
      })
      throw error
    }
    return { ready: false, requestId }
  })
}

export async function httpIntegrationStatus(
  deps: AppDeps,
  project: string,
  service: string,
  requestId: string,
): Promise<HttpIntegrationOperation> {
  const path = operationPath(deps, requestId)
  if (!existsSync(path)) throw new ActionRefused('no HTTP integration has this request id', '', 404)
  let operation = HttpIntegrationOperation.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (operation.project !== project || operation.service !== service)
    throw new ActionRefused('no HTTP integration has this request id', '', 404)
  const snapshot = await deps.cache.get(true)
  if (operation.state === 'pending' || operation.state === 'running') {
    const runner = await runnerStatus(deps.client, snapshot, deps.config)
    // The CLI may have finished while Docker was inspected.
    operation = HttpIntegrationOperation.parse(JSON.parse(readFileSync(path, 'utf8')))
    if (
      (operation.state === 'pending' || operation.state === 'running') &&
      !runningOperation(deps, operation, runner)
    ) {
      return { ...operation, state: 'failed', error: 'the runner stopped before HTTP integration completed' }
    }
  }
  if (operation.state === 'ok') {
    const refreshed = await deps.cache.get(true)
    const target = refreshed.containers.find(
      (entry) => entry.environment === project && entry.service === service && !entry.oneOff,
    )
    if (target?.state !== 'running' || !target.onGatewayNetwork) {
      return { ...operation, state: 'failed', error: 'the service is not running on the gateway network' }
    }
  }
  return operation
}
