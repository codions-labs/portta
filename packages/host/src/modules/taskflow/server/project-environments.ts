import type {
  Endpoint,
  EnvironmentHandle,
  EnvironmentRecord,
  EnvironmentService,
  EnvironmentWorkspace,
  ResolvedEnvironment,
} from 'portta-core/taskflow'
import type { ProjectConfig } from '../adapters/config.ts'
import type { NodeDockerGateway } from '../adapters/docker.ts'
import { DockerComposeEnvironmentProvider } from '../adapters/docker-compose-environment.ts'
import { DockerEnvironmentProvider } from '../adapters/docker-environment.ts'
import type { EnvironmentProvider, ExecutionTransport } from '../adapters/environment-provider.ts'
import type { EnvironmentStore } from '../adapters/environment-store.ts'
import { log } from '../lib/log.ts'
import {
  environmentIdFor,
  environmentsForInstallation,
  selectEnvironmentProvider,
} from '../services/environment-coordinator.ts'
import { environmentTrustPatch, reconcileEnvironment } from '../services/environment-reconciliation.ts'
import { applyEnvironmentResourcePolicy, hasEnvironmentCapacity } from '../services/environment-resource-policy.ts'
import { mergeEnvironmentServices } from '../services/environment-service-discovery.ts'
import { LocalDatagramForwardProvider } from '../services/local-datagram-forward-provider.ts'
import { LocalForwardProvider } from '../services/local-forward-provider.ts'
import type { ProjectRuntime } from '../services/project-runtime.ts'
import type { ProjectHost } from './project-app.ts'

export const MAX_CONCURRENT_PROJECT_ENVIRONMENTS = 8

export interface ProjectEnvironmentsDeps {
  projectId: string
  installationId: string
  projectDir: string
  config: ProjectConfig
  projectRuntime: ProjectRuntime
  docker: NodeDockerGateway
  host: ProjectHost
}

export type PrepareEnvironmentResult =
  | { ok: true; environmentId: string }
  | {
      ok: false
      reason: 'unavailable' | 'selection_required' | 'trust_required'
      diagnostics: string[]
      environmentId?: string
    }

export interface PrepareEnvironmentInput {
  workspacePath: string
  workspaceId: string
  profileName: string | null
  runId?: string
  start: boolean
}

export type EnvironmentAction = 'trust' | 'start' | 'stop' | 'restart' | 'rebuild'

export type EnvironmentActionResult =
  | { ok: true; environment: Omit<EnvironmentRecord, 'providerRef'> }
  | { ok: false; error: string; status: 404 | 409 }

export interface ProjectEnvironments {
  store: EnvironmentStore
  prepareWorkspaceEnvironment(input: PrepareEnvironmentInput): Promise<PrepareEnvironmentResult>
  publicEnvironment(record: EnvironmentRecord): Omit<EnvironmentRecord, 'providerRef'>
  environmentForProject(id: string): EnvironmentRecord | null
  projectEnvironments(): EnvironmentRecord[]
  environmentTransport(record: EnvironmentRecord): (EnvironmentProvider & ExecutionTransport) | null
  isLocalEnvironmentEndpoint(endpoint: Endpoint): boolean
  revokeLocalEndpoint(endpoint: Endpoint): Promise<void>
  terminalCommandForEnvironment(environmentId: string, command: string): string
  workspaceForEnvironment(environmentId: string): EnvironmentWorkspace
  resolvedFromRecord(record: EnvironmentRecord): ResolvedEnvironment
  saveEnvironment(record: EnvironmentRecord, patch: Partial<EnvironmentRecord>): EnvironmentRecord
  destroyEnvironmentRecord(record: EnvironmentRecord): Promise<void>
  environmentServices(record: EnvironmentRecord): Promise<EnvironmentService[]>
  controlEnvironmentService(
    record: EnvironmentRecord,
    service: EnvironmentService,
    action: 'start' | 'stop' | 'restart',
  ): Promise<void>
  reconcileProjectEnvironments(): Promise<void>
  publishEnvironmentService(
    record: EnvironmentRecord,
    service: EnvironmentService,
    existing?: Endpoint,
  ): Promise<Endpoint>
  deactivateEnvironmentAccess(record: EnvironmentRecord, removeIntent: boolean): Promise<void>
  /** Trust, start, stop, restart or rebuild an environment of this Project. */
  applyEnvironmentAction(id: string, action: EnvironmentAction): Promise<EnvironmentActionResult>
  close(): Promise<void>
}

/** The execution environments of one Project: preparing them for worktrees
 *  and Runs, their services, and the local endpoints published for those. */
export function createProjectEnvironments(deps: ProjectEnvironmentsDeps): ProjectEnvironments {
  const { projectId: instancePrefix, installationId, projectDir: PROJECT_DIR, config, projectRuntime } = deps
  const {
    environmentStore,
    hostEnvironmentProvider,
    devContainerProvider,
    dockerfileEnvironmentProvider,
    processRunner: serverProcessRunner,
    dockerServiceDiscovery,
    endpointExposure,
  } = deps.host
  const localForwards = new LocalForwardProvider()
  const localDatagramForwards = new LocalDatagramForwardProvider()
  const dockerEnvironmentProvider = new DockerEnvironmentProvider({
    projectRoot: PROJECT_DIR,
    profiles: config.profiles,
    services: config.services,
    startupEnv: Object.fromEntries(Object.entries(config.startupEnvs).map(([key, value]) => [key, String(value)])),
    docker: deps.docker,
  })
  const composeEnvironmentProvider = new DockerComposeEnvironmentProvider()

  async function prepareWorkspaceEnvironment(input: PrepareEnvironmentInput): Promise<PrepareEnvironmentResult> {
    const scope = {
      installationId,
      projectId: instancePrefix,
      workspaceId: input.workspaceId,
      ...(input.runId ? { runId: input.runId } : {}),
    }
    const context = { workspacePath: input.workspacePath, projectPath: PROJECT_DIR, scope }
    const profile = input.profileName ? config.profiles[input.profileName] : undefined
    const selection = profile?.environment?.provider ?? (profile?.runtime === 'docker' ? 'docker' : 'auto')
    const requestedProvider =
      selection === 'devcontainer' ||
      selection === 'compose' ||
      selection === 'docker' ||
      selection === 'dockerfile' ||
      selection === 'host'
        ? selection
        : 'host'
    try {
      const probe = await devContainerProvider.probe(context)
      const composeProbe =
        selection === 'auto' || selection === 'compose' ? await composeEnvironmentProvider.probe(context) : null
      const dockerfileProbe =
        selection === 'auto' || selection === 'dockerfile' ? await dockerfileEnvironmentProvider.probe(context) : null
      if (probe.configRefs.length > 0 && !probe.available && selection === 'devcontainer') {
        return { ok: false, reason: 'unavailable', diagnostics: probe.diagnostics }
      }
      const selected = selectEnvironmentProvider(
        selection,
        probe.available,
        probe.configRefs.length,
        Boolean(profile?.environment?.config),
        composeProbe?.available === true,
        dockerfileProbe?.available === true,
      )
      if (selected === 'selection_required') {
        return { ok: false, reason: 'selection_required', diagnostics: probe.configRefs }
      }
      const provider =
        selected === 'devcontainer'
          ? devContainerProvider
          : selected === 'docker'
            ? dockerEnvironmentProvider
            : selected === 'compose'
              ? composeEnvironmentProvider
              : selected === 'dockerfile'
                ? dockerfileEnvironmentProvider
                : hostEnvironmentProvider
      const resolved = await provider.resolve({
        ...context,
        configRef: selected === 'docker' ? (input.profileName ?? undefined) : profile?.environment?.config,
      })
      const id = environmentIdFor(scope, resolved.provider, resolved.configRef)
      const existing = environmentStore.get(id)
      const now = new Date().toISOString()
      const trusted =
        resolved.provider !== 'devcontainer' ||
        resolved.configRef === null ||
        environmentStore.isTrusted(scope.projectId, resolved.configRef, resolved.configHash)
      if (!trusted) {
        environmentStore.save({
          id,
          provider: resolved.provider,
          scope,
          status: 'awaiting_trust',
          desiredStatus: input.start ? 'ready' : 'stopped',
          workspace: resolved.workspace,
          providerRef: { schemaVersion: 1, value: {} },
          configRef: resolved.configRef,
          configHash: resolved.configHash,
          capabilities: resolved.capabilities,
          security: { ...resolved.security, trusted: false },
          error: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        return { ok: false, reason: 'trust_required', diagnostics: resolved.security.reasons, environmentId: id }
      }
      if (
        input.start &&
        resolved.provider !== 'host' &&
        !hasEnvironmentCapacity(projectEnvironments(), id, MAX_CONCURRENT_PROJECT_ENVIRONMENTS)
      ) {
        return {
          ok: false,
          reason: 'unavailable',
          diagnostics: [`Project environment concurrency limit reached (${MAX_CONCURRENT_PROJECT_ENVIRONMENTS})`],
        }
      }
      let handle: EnvironmentHandle
      const reusable =
        existing &&
        existing.configHash === resolved.configHash &&
        (existing.provider === 'host' ||
          existing.providerRef.value.containerId ||
          existing.providerRef.value.containerName)
      if (!input.start && resolved.provider !== 'host') {
        if (reusable) {
          const observed = await provider.inspect(existing)
          handle = { ...existing, scope, status: observed.status }
        } else {
          handle = {
            id,
            provider: resolved.provider,
            scope,
            status: 'detected',
            workspace: resolved.workspace,
            providerRef: { schemaVersion: 1, value: {} },
          }
        }
      } else if (reusable) {
        const observed = await provider.inspect(existing)
        handle =
          observed.status === 'ready'
            ? { ...existing, scope, status: 'ready' }
            : observed.status === 'stopped'
              ? await provider.resume(existing)
              : await provider.start(resolved, scope)
      } else {
        handle = await provider.start(resolved, scope)
      }
      if (handle.provider !== 'host' && handle.status === 'ready') {
        try {
          handle = await applyEnvironmentResourcePolicy(serverProcessRunner, handle)
        } catch (error: unknown) {
          await provider.destroy(handle)
          throw error
        }
      }
      environmentStore.save({
        ...handle,
        desiredStatus: input.start || resolved.provider === 'host' ? 'ready' : 'stopped',
        configRef: resolved.configRef,
        configHash: resolved.configHash,
        capabilities: resolved.capabilities,
        security: { ...resolved.security, trusted: true },
        error: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      return { ok: true, environmentId: id }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const id = environmentIdFor(scope, requestedProvider, profile?.environment?.config ?? null)
      const existing = environmentStore.get(id)
      const now = new Date().toISOString()
      environmentStore.save({
        id,
        provider: requestedProvider,
        scope,
        status: 'failed',
        desiredStatus: input.start ? 'ready' : 'stopped',
        workspace: { hostPath: input.workspacePath },
        providerRef: { schemaVersion: 1, value: {} },
        configRef: profile?.environment?.config ?? null,
        configHash: 'unresolved',
        capabilities: {
          exec: false,
          stdin: false,
          pty: false,
          resize: false,
          signals: false,
          reattach: false,
          services: false,
          rebuild: false,
        },
        security: {
          trusted: false,
          reasons: [message],
          initializeCommand: false,
          privileged: false,
          dockerSocket: false,
          devices: false,
          broadMounts: false,
          features: [],
          unpinnedFeatures: [],
          addedCapabilities: [],
          securityOptions: [],
          secretKeys: [],
          isolationRisks: [],
        },
        error: message,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      return {
        ok: false,
        reason: 'unavailable',
        diagnostics: [message],
      }
    }
  }

  function publicEnvironment(record: EnvironmentRecord): Omit<EnvironmentRecord, 'providerRef'> {
    const { providerRef: _providerRef, ...environment } = record
    return environment
  }

  function environmentForProject(id: string): EnvironmentRecord | null {
    const record = environmentStore.get(id)
    return record?.scope.projectId === instancePrefix && record.scope.installationId === installationId ? record : null
  }

  function projectEnvironments(): EnvironmentRecord[] {
    return environmentsForInstallation(environmentStore.list(instancePrefix), instancePrefix, installationId)
  }

  function environmentTransport(record: EnvironmentRecord): (EnvironmentProvider & ExecutionTransport) | null {
    return record.provider === 'devcontainer'
      ? devContainerProvider
      : record.provider === 'docker'
        ? dockerEnvironmentProvider
        : record.provider === 'compose'
          ? composeEnvironmentProvider
          : record.provider === 'dockerfile'
            ? dockerfileEnvironmentProvider
            : record.provider === 'host'
              ? hostEnvironmentProvider
              : null
  }

  function isPublishedEndpoint(endpoint: Endpoint): boolean {
    return endpointExposure.kind !== 'disabled' && endpoint.provider === endpointExposure.kind
  }

  function isLocalEnvironmentEndpoint(endpoint: Endpoint): boolean {
    return (
      endpoint.provider === 'local-forward' ||
      endpoint.provider === 'local-udp-forward' ||
      isPublishedEndpoint(endpoint)
    )
  }

  async function revokeLocalEndpoint(endpoint: Endpoint): Promise<void> {
    const forwardId = endpoint.providerResourceId ?? endpoint.id
    if (endpoint.provider === 'local-udp-forward') await localDatagramForwards.revoke(forwardId)
    else await localForwards.revoke(forwardId)
    if (isPublishedEndpoint(endpoint))
      await endpointExposure.revoke({ endpointId: endpoint.id, projectId: instancePrefix })
  }

  function terminalCommandForEnvironment(environmentId: string, command: string): string {
    const record = environmentForProject(environmentId)
    if (record?.status !== 'ready') throw new Error(`Environment is not ready: ${environmentId}`)
    const transport = environmentTransport(record)
    if (!transport) throw new Error(`Environment transport is unavailable: ${record.provider}`)
    return transport.terminalCommand(record, command)
  }

  function workspaceForEnvironment(environmentId: string): EnvironmentWorkspace {
    const environment = environmentForProject(environmentId)
    if (!environment) throw new Error(`Environment was not found: ${environmentId}`)
    return environment.workspace
  }

  function resolvedFromRecord(record: EnvironmentRecord): ResolvedEnvironment {
    return {
      provider: record.provider,
      configRef: record.configRef,
      configHash: record.configHash,
      workspace: record.workspace,
      capabilities: record.capabilities,
      security: record.security,
    }
  }

  function saveEnvironment(record: EnvironmentRecord, patch: Partial<EnvironmentRecord>): EnvironmentRecord {
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() }
    environmentStore.save(next)
    return next
  }

  async function destroyEnvironmentRecord(record: EnvironmentRecord): Promise<void> {
    const provider = environmentTransport(record)
    if (!provider) throw new Error(`Environment provider is unavailable: ${record.provider}`)
    const destroying = saveEnvironment(record, { desiredStatus: 'destroyed', status: 'stopping' })
    await deactivateEnvironmentAccess(destroying, true)
    await provider.destroy(destroying)
    environmentStore.remove(destroying.id)
  }

  async function environmentServices(record: EnvironmentRecord): Promise<EnvironmentService[]> {
    const worktree = projectRuntime.getWorktree(record.scope.workspaceId)
    const containerId = record.providerRef.value.containerId
    const manual = (worktree?.services ?? []).map((service) => {
      const configured = config.services.find((candidate) => candidate.name === service.name)
      const protocol = configured?.protocol ?? (service.url ? 'http' : 'tcp')
      const serviceId = `service_${record.id}_${service.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      const endpointUrl = service.url ?? (service.port ? `${protocol}://127.0.0.1:${service.port}` : null)
      return {
        id: serviceId,
        environmentId: record.id,
        name: service.name,
        status: service.running ? ('running' as const) : ('stopped' as const),
        kind:
          protocol === 'http' || protocol === 'https'
            ? ('http' as const)
            : protocol === 'tcp'
              ? ('tcp' as const)
              : ('unknown' as const),
        containerIds: typeof containerId === 'string' && containerId ? [containerId] : [],
        ports: service.port ? [{ containerPort: service.port, protocol }] : [],
        endpoints: endpointUrl
          ? [
              {
                id: `endpoint_${record.id}_${service.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
                serviceId,
                url: endpointUrl,
                audiences: ['taskflow' as const, 'user' as const],
                visibility: 'private' as const,
                accessMode: 'localhost' as const,
                executionLocus: 'host' as const,
                stable: false,
                provider: 'manual',
              },
            ]
          : [],
        provenance: [
          { source: 'taskflow' as const, detail: 'project services configuration', confidence: 'explicit' as const },
        ],
      }
    })
    const persisted = environmentStore.listServices(record.id)
    let observed: EnvironmentService[] = []
    if (record.status === 'ready' && record.provider !== 'host') {
      observed = await dockerServiceDiscovery.discover(record)
    }
    const services = mergeEnvironmentServices([persisted, observed, manual])
    for (const service of services) {
      service.actions =
        (record.provider === 'compose' || record.provider === 'devcontainer') && service.containerIds.length > 0
          ? ['start', 'stop', 'restart']
          : []
    }
    for (const service of services) {
      const published = service.endpoints.find((endpoint) => isLocalEnvironmentEndpoint(endpoint))
      if (!published) continue
      const forwardId = published.providerResourceId ?? published.id
      if (published.provider === 'local-udp-forward' && localDatagramForwards.has(forwardId)) continue
      if (localForwards.has(forwardId)) continue
      const restored = await publishEnvironmentService(record, service, published)
      service.endpoints = service.endpoints.filter((endpoint) => endpoint.id !== published.id).concat(restored)
    }
    if (
      record.status === 'ready' &&
      record.provider !== 'host' &&
      config.exposure.local.provider !== 'disabled' &&
      config.exposure.local.autoExpose !== 'manual'
    ) {
      for (const service of services) {
        const port = service.ports[0]
        if (
          service.status !== 'running' ||
          !port ||
          service.endpoints.some((endpoint) => endpoint.audiences.includes('user')) ||
          (config.exposure.local.autoExpose === 'http' && port.protocol !== 'http' && port.protocol !== 'https')
        ) {
          continue
        }
        try {
          const endpoint = await publishEnvironmentService(record, service)
          service.endpoints = service.endpoints.concat(endpoint)
        } catch (error: unknown) {
          log.warn(
            `[environment:expose] environment=${record.id} service=${service.name} ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
    environmentStore.replaceServices(record.id, services)
    return services
  }

  async function controlEnvironmentService(
    record: EnvironmentRecord,
    service: EnvironmentService,
    action: 'start' | 'stop' | 'restart',
  ): Promise<void> {
    if (!service.actions?.includes(action)) {
      throw new Error(`Service action is unavailable for ${service.name}`)
    }
    const provider = environmentTransport(record)
    if (!provider?.controlService) throw new Error(`Service control is unavailable for ${record.provider}`)
    await provider.controlService(record, service, action)
  }

  async function reconcileProjectEnvironments(): Promise<void> {
    await Promise.all(
      projectEnvironments().map(async (record): Promise<void> => {
        const provider = environmentTransport(record)
        if (!provider) return
        const reconciled = await reconcileEnvironment(record, provider, new Date().toISOString(), () =>
          deactivateEnvironmentAccess(record, false),
        )
        if (reconciled.desiredStatus === 'destroyed' && reconciled.status === 'missing') {
          environmentStore.remove(reconciled.id)
        } else environmentStore.save(reconciled)
      }),
    )
  }

  async function publishEnvironmentService(
    record: EnvironmentRecord,
    service: EnvironmentService,
    existing?: Endpoint,
  ): Promise<Endpoint> {
    if (record.status !== 'ready') throw new Error('Environment is not ready')
    const transport = environmentTransport(record)
    if (!transport) throw new Error(`Environment transport is unavailable: ${record.provider}`)
    const port = service.ports[0]
    if (!port) throw new Error(`Service cannot be forwarded: ${service.name}`)
    const internal = service.endpoints.find(
      (endpoint) => endpoint.accessMode === 'internal' && endpoint.url.endsWith(`:${port.containerPort}`),
    )
    const target = internal ?? service.endpoints[0]
    const targetUrl = target ? new URL(target.url) : null
    const targetHost = targetUrl?.hostname ?? service.name
    const targetPort = targetUrl?.port ? Number(targetUrl.port) : port.containerPort
    const forwardId = existing?.providerResourceId ?? `endpoint_${service.id}_forward_${port.containerPort}`
    if (port.protocol === 'udp') {
      return localDatagramForwards.publish({
        endpointId: forwardId,
        serviceId: service.id,
        targetHost,
        port: { ...port, containerPort: targetPort },
        environment: record,
        transport,
      })
    }
    const forward = await localForwards.publish({
      endpointId: forwardId,
      serviceId: service.id,
      targetHost,
      port: { ...port, containerPort: targetPort },
      environment: record,
      transport,
    })
    if (port.protocol !== 'http' && port.protocol !== 'https') return forward
    const endpointId = existing?.id ?? `endpoint_${service.id}_http`
    const published = await endpointExposure.publish({
      endpointId,
      projectId: record.scope.projectId,
      environmentId: record.id,
      workspaceId: record.scope.workspaceId,
      serviceName: service.name,
      targetUrl: forward.url,
    })
    if (!published) return forward
    return {
      id: endpointId,
      serviceId: service.id,
      url: published.url,
      audiences: ['taskflow' as const, 'user' as const],
      visibility: 'private' as const,
      accessMode: 'localhost' as const,
      executionLocus: 'host' as const,
      stable: true,
      provider: endpointExposure.kind,
      providerResourceId: forwardId,
    }
  }

  async function deactivateEnvironmentAccess(record: EnvironmentRecord, removeIntent: boolean): Promise<void> {
    const services = environmentStore.listServices(record.id)
    for (const service of services) {
      for (const endpoint of service.endpoints) {
        if (!isLocalEnvironmentEndpoint(endpoint)) continue
        await revokeLocalEndpoint(endpoint)
      }
      if (removeIntent) {
        service.endpoints = service.endpoints.filter((endpoint) => !isLocalEnvironmentEndpoint(endpoint))
      }
    }
    if (removeIntent) environmentStore.replaceServices(record.id, services)
  }

  async function applyEnvironmentAction(id: string, action: EnvironmentAction): Promise<EnvironmentActionResult> {
    const record = environmentForProject(id)
    if (!record) return { ok: false, error: 'Environment not found', status: 404 }
    const provider = environmentTransport(record)
    if (!provider) return { ok: false, error: `Environment provider is unavailable: ${record.provider}`, status: 409 }
    if (action === 'trust') {
      if (!record.configRef) return { ok: true, environment: publicEnvironment(record) }
      environmentStore.trust(record.scope.projectId, record.configRef, record.configHash)
      const trusted = saveEnvironment(record, {
        ...environmentTrustPatch(record),
        desiredStatus: record.desiredStatus === 'destroyed' ? 'destroyed' : 'ready',
      })
      if (trusted.desiredStatus === 'ready') return await applyEnvironmentAction(id, 'start')
      return { ok: true, environment: publicEnvironment(trusted) }
    }
    if (!record.security.trusted) return { ok: false, error: 'Environment configuration requires trust', status: 409 }
    if (
      action !== 'stop' &&
      record.provider !== 'host' &&
      !hasEnvironmentCapacity(projectEnvironments(), record.id, MAX_CONCURRENT_PROJECT_ENVIRONMENTS)
    ) {
      return {
        ok: false,
        error: `Project environment concurrency limit reached (${MAX_CONCURRENT_PROJECT_ENVIRONMENTS})`,
        status: 409,
      }
    }
    try {
      let resolved = resolvedFromRecord(record)
      if (action !== 'stop') {
        resolved = await provider.resolve({
          workspacePath: record.workspace.hostPath,
          projectPath: PROJECT_DIR,
          scope: record.scope,
          configRef: record.configRef ?? undefined,
        })
        if (resolved.configHash !== record.configHash && resolved.provider === 'devcontainer') {
          const trusted =
            resolved.configRef !== null &&
            environmentStore.isTrusted(record.scope.projectId, resolved.configRef, resolved.configHash)
          if (!trusted) {
            saveEnvironment(record, {
              status: 'awaiting_trust',
              desiredStatus: 'ready',
              configHash: resolved.configHash,
              security: { ...resolved.security, trusted: false },
            })
            return { ok: false, error: 'Environment configuration changed and requires trust', status: 409 }
          }
        }
      }
      let handle: EnvironmentHandle
      if (action === 'stop') {
        const stopping = saveEnvironment(record, { status: 'stopping', desiredStatus: 'stopped', error: null })
        await deactivateEnvironmentAccess(stopping, false)
        await provider.stop(stopping)
        return {
          ok: true,
          environment: publicEnvironment(saveEnvironment(stopping, { status: 'stopped', desiredStatus: 'stopped' })),
        }
      }
      if (action === 'restart') {
        const restarting = saveEnvironment(record, { status: 'stopping', desiredStatus: 'ready', error: null })
        await deactivateEnvironmentAccess(restarting, false)
        await provider.stop(restarting)
        saveEnvironment(restarting, { status: 'starting' })
        handle = await provider.resume(restarting)
      } else if (action === 'rebuild') {
        const rebuilding = saveEnvironment(record, { status: 'building', desiredStatus: 'ready', error: null })
        await deactivateEnvironmentAccess(rebuilding, false)
        handle = await provider.rebuild(resolved, rebuilding.scope, rebuilding)
      } else {
        const observed = record.status === 'ready' ? await provider.inspect(record) : { status: 'missing' as const }
        if (observed.status === 'ready') handle = { ...record, status: 'ready' }
        else {
          const starting = saveEnvironment(record, { status: 'starting', desiredStatus: 'ready', error: null })
          handle =
            observed.status === 'stopped'
              ? await provider.resume(starting)
              : await provider.start(resolved, starting.scope)
        }
      }
      if (handle.provider !== 'host') handle = await applyEnvironmentResourcePolicy(serverProcessRunner, handle)
      return {
        ok: true,
        environment: publicEnvironment(saveEnvironment(record, { ...handle, desiredStatus: 'ready', error: null })),
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const current = environmentStore.get(record.id) ?? record
      saveEnvironment(current, { status: 'failed', error: message })
      throw error
    }
  }

  /** Revoke published names and close every forward; the Project is going away. */
  async function close(): Promise<void> {
    for (const environment of projectEnvironments()) {
      for (const service of environmentStore.listServices(environment.id)) {
        for (const endpoint of service.endpoints.filter(isPublishedEndpoint)) {
          await endpointExposure.revoke({ endpointId: endpoint.id, projectId: instancePrefix })
        }
      }
    }
    await Promise.all([localForwards.close(), localDatagramForwards.close()])
  }

  return {
    store: environmentStore,
    prepareWorkspaceEnvironment,
    publicEnvironment,
    environmentForProject,
    projectEnvironments,
    environmentTransport,
    isLocalEnvironmentEndpoint,
    revokeLocalEndpoint,
    terminalCommandForEnvironment,
    workspaceForEnvironment,
    resolvedFromRecord,
    saveEnvironment,
    destroyEnvironmentRecord,
    environmentServices,
    controlEnvironmentService,
    reconcileProjectEnvironments,
    publishEnvironmentService,
    deactivateEnvironmentAccess,
    applyEnvironmentAction,
    close,
  }
}
