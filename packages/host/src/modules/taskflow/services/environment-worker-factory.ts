import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, relative } from 'node:path'
import type { EnvironmentHandle } from 'portta-core/taskflow'
import type { ExecutionTransport } from '../adapters/environment-provider.ts'
import {
  type AgentResult,
  type AgentSpec,
  type BuiltinProviderId,
  DefaultWorkerFactory,
  type ProviderId,
  type Worker,
  type WorkerContext,
  type WorkerFactory,
} from '../workflows/index.ts'

// Only the builtins have a shim: a non-builtin id reaches DefaultWorkerFactory.get, which refuses
// it with unknown_provider (declared providers exist for the ACP transport only).
const executableByProvider: Record<BuiltinProviderId, string> = {
  codex: 'codex',
  'claude-code': 'claude',
  opencode: 'opencode',
  pi: 'pi',
}
const environmentCwdVariable = 'PORTTA_FLOW_ENVIRONMENT_CWD'

class MappedWorkspaceWorker implements Worker {
  readonly id: ProviderId

  private readonly worker: Worker
  private readonly hostWorkspace: string
  private readonly containerWorkspace: string
  constructor(worker: Worker, hostWorkspace: string, containerWorkspace: string) {
    this.worker = worker
    this.hostWorkspace = hostWorkspace
    this.containerWorkspace = containerWorkspace
    this.id = worker.id
  }

  runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult> {
    return this.worker.runAgent(mapAgentSpecToEnvironment(spec, this.hostWorkspace, this.containerWorkspace), context)
  }

  shutdown(): Promise<void> {
    return this.worker.shutdown()
  }
}

export function mapAgentSpecToEnvironment(
  spec: AgentSpec,
  hostWorkspace: string,
  containerWorkspace: string,
): AgentSpec {
  const suffix = relative(hostWorkspace, spec.cwd)
  if (suffix.startsWith('..')) {
    throw new Error(`Execution workspace is outside the environment mount: ${spec.cwd}`)
  }
  const cwd = suffix ? posix.join(containerWorkspace, ...suffix.split(/[\\/]/)) : containerWorkspace
  return {
    ...spec,
    cwd,
    launcherCwd: spec.cwd,
    launcherEnv: { ...spec.launcherEnv, [environmentCwdVariable]: cwd },
  }
}

export class EnvironmentWorkerFactory implements WorkerFactory {
  private readonly directory: string
  private readonly factory: DefaultWorkerFactory
  private readonly workers = new Map<ProviderId, Worker>()

  private readonly handle: EnvironmentHandle
  constructor(handle: EnvironmentHandle, transport: ExecutionTransport) {
    this.handle = handle
    const containerWorkspace = handle.workspace.containerPath
    if (!containerWorkspace) throw new Error(`Environment has no container workspace: ${handle.id}`)
    this.directory = mkdtempSync(join(tmpdir(), 'taskflow-environment-workers-'))
    const paths = Object.fromEntries(
      Object.entries(executableByProvider).map(([provider, executable]) => {
        const path = join(this.directory, provider)
        writeFileSync(path, transport.executableShim(handle, executable), { encoding: 'utf8', mode: 0o700 })
        chmodSync(path, 0o700)
        return [provider, path]
      }),
    )
    this.factory = new DefaultWorkerFactory({
      codexBin: paths.codex,
      pathToClaudeCodeExecutable: paths['claude-code'],
      opencodeBin: paths.opencode,
      piBin: paths.pi,
    })
  }

  get(id: ProviderId): Worker {
    const existing = this.workers.get(id)
    if (existing) return existing
    const containerWorkspace = this.handle.workspace.containerPath
    if (!containerWorkspace) throw new Error(`Environment has no container workspace: ${this.handle.id}`)
    const worker = new MappedWorkspaceWorker(this.factory.get(id), this.handle.workspace.hostPath, containerWorkspace)
    this.workers.set(id, worker)
    return worker
  }

  async shutdownAll(): Promise<void> {
    await this.factory.shutdownAll()
    rmSync(this.directory, { recursive: true, force: true })
    this.workers.clear()
  }
}

export interface EnvironmentWorkerRoute {
  handle: EnvironmentHandle
  transport: ExecutionTransport
}

class RoutingEnvironmentWorker implements Worker {
  readonly id: ProviderId

  private readonly resolve: (cwd: string) => EnvironmentWorkerRoute
  private readonly factoryFor: (route: EnvironmentWorkerRoute) => EnvironmentWorkerFactory
  constructor(
    id: ProviderId,
    resolve: (cwd: string) => EnvironmentWorkerRoute,
    factoryFor: (route: EnvironmentWorkerRoute) => EnvironmentWorkerFactory,
  ) {
    this.resolve = resolve
    this.factoryFor = factoryFor
    this.id = id
  }

  runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult> {
    const route = this.resolve(spec.cwd)
    return this.factoryFor(route).get(this.id).runAgent(spec, context)
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

export class RoutingEnvironmentWorkerFactory implements WorkerFactory {
  private readonly factories = new Map<string, EnvironmentWorkerFactory>()
  private readonly workers = new Map<ProviderId, Worker>()

  private readonly resolve: (cwd: string) => EnvironmentWorkerRoute
  private readonly onShutdown?: () => void
  constructor(resolve: (cwd: string) => EnvironmentWorkerRoute, onShutdown?: () => void) {
    this.resolve = resolve
    this.onShutdown = onShutdown
  }

  get(id: ProviderId): Worker {
    const existing = this.workers.get(id)
    if (existing) return existing
    const worker = new RoutingEnvironmentWorker(id, this.resolve, (route) => this.factoryFor(route))
    this.workers.set(id, worker)
    return worker
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(Array.from(this.factories.values(), (factory) => factory.shutdownAll()))
    this.factories.clear()
    this.workers.clear()
    this.onShutdown?.()
  }

  private factoryFor(route: EnvironmentWorkerRoute): EnvironmentWorkerFactory {
    const existing = this.factories.get(route.handle.id)
    if (existing) return existing
    const factory = new EnvironmentWorkerFactory(route.handle, route.transport)
    this.factories.set(route.handle.id, factory)
    return factory
  }
}
