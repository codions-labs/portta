import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  EnvironmentCommand,
  EnvironmentCommandHandle,
  EnvironmentHandle,
  EnvironmentScope,
  ResolvedEnvironment,
} from 'portta-core/taskflow'
import { environmentIdFor } from '../services/environment-coordinator.ts'
import type {
  EnvironmentContext,
  EnvironmentProbe,
  EnvironmentProvider,
  ExecutionTransport,
  ObservedEnvironment,
} from './environment-provider.ts'
import { HostEnvironmentProvider } from './host-environment.ts'
import { NodeProcessRunner, type ProcessRunner, runCaptured } from './process-runner.ts'

const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']

function composeFile(workspacePath: string, configured?: string): string {
  if (configured) {
    const candidate = resolve(workspacePath, configured)
    if (existsSync(candidate)) return candidate
    throw new Error(`Docker Compose file does not exist: ${configured}`)
  }
  const found = COMPOSE_FILENAMES.map((file) => resolve(workspacePath, file)).find(existsSync)
  if (!found) throw new Error('No Docker Compose file was found')
  return found
}

function composeProjectName(environmentId: string): string {
  return `taskflow-${environmentId.replace(/^env_/, '')}`
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export class DockerComposeEnvironmentProvider implements EnvironmentProvider, ExecutionTransport {
  readonly id = 'compose' as const
  readonly provider = 'compose' as const
  private readonly host: HostEnvironmentProvider

  private readonly runner: ProcessRunner
  constructor(runner: ProcessRunner = new NodeProcessRunner(), host?: HostEnvironmentProvider) {
    this.runner = runner
    this.host = host ?? new HostEnvironmentProvider(runner)
  }

  async probe(context: EnvironmentContext): Promise<EnvironmentProbe> {
    const version = await runCaptured(this.runner, { command: 'docker', args: ['compose', 'version', '--short'] })
    const configs = COMPOSE_FILENAMES.map((file) => resolve(context.workspacePath, file)).filter(existsSync)
    return {
      provider: this.id,
      available: version.exit.code === 0 && configs.length > 0,
      configRefs: configs,
      ...(version.exit.code === 0 ? { version: version.stdout.trim() } : {}),
      diagnostics:
        version.exit.code === 0
          ? configs.length > 0
            ? []
            : ['No Docker Compose file was found']
          : [version.stderr.trim() || 'Docker Compose is unavailable'],
    }
  }

  async resolve(context: EnvironmentContext): Promise<ResolvedEnvironment> {
    const file = composeFile(context.workspacePath, context.configRef)
    const source = readFileSync(file, 'utf8')
    return {
      provider: this.id,
      configRef: file,
      configHash: createHash('sha256').update(source).digest('hex'),
      workspace: { hostPath: context.workspacePath },
      capabilities: {
        exec: true,
        stdin: true,
        pty: false,
        resize: false,
        signals: true,
        reattach: false,
        services: true,
        rebuild: true,
      },
      security: {
        trusted: true,
        reasons: [],
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
    }
  }

  private args(handle: EnvironmentHandle, command: string[]): string[] {
    const file = handle.providerRef.value.composeFile
    const project = handle.providerRef.value.composeProjectName
    if (typeof file !== 'string' || typeof project !== 'string')
      throw new Error('Compose environment metadata is missing')
    return ['compose', '--project-name', project, '-f', file, ...command]
  }

  private async startStack(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    build: boolean,
  ): Promise<EnvironmentHandle> {
    const id = environmentIdFor(scope, this.id, environment.configRef)
    const project = composeProjectName(id)
    const handle: EnvironmentHandle = {
      id,
      provider: this.id,
      scope,
      status: 'starting',
      workspace: environment.workspace,
      providerRef: {
        schemaVersion: 1,
        value: { composeFile: environment.configRef, composeProjectName: project },
      },
    }
    const up = await runCaptured(this.runner, {
      command: 'docker',
      args: this.args(handle, ['up', '--detach', ...(build ? ['--build'] : []), '--remove-orphans']),
      cwd: environment.workspace.hostPath,
    })
    if (up.exit.code !== 0) throw new Error(up.stderr.trim() || 'Docker Compose failed to start')
    const containers = await runCaptured(this.runner, {
      command: 'docker',
      args: this.args(handle, ['ps', '--quiet']),
      cwd: environment.workspace.hostPath,
    })
    const containerId = containers.stdout.split(/\s+/).find(Boolean)
    return {
      ...handle,
      status: 'ready',
      providerRef: {
        ...handle.providerRef,
        value: { ...handle.providerRef.value, ...(containerId ? { containerId } : {}) },
      },
    }
  }

  async start(environment: ResolvedEnvironment, scope: EnvironmentScope): Promise<EnvironmentHandle> {
    return this.startStack(environment, scope, false)
  }

  async inspect(handle: EnvironmentHandle): Promise<ObservedEnvironment> {
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: this.args(handle, ['ps', '--all', '--quiet']),
      cwd: handle.workspace.hostPath,
    })
    if (result.exit.code !== 0) return { status: 'missing', containerIds: [], diagnostics: [result.stderr.trim()] }
    const containerIds = result.stdout.split(/\s+/).filter(Boolean)
    if (containerIds.length === 0) return { status: 'stopped', containerIds, diagnostics: [] }
    const inspected = await runCaptured(this.runner, {
      command: 'docker',
      args: ['inspect', '--format', '{{.State.Status}}', ...containerIds],
      cwd: handle.workspace.hostPath,
    })
    if (inspected.exit.code !== 0) {
      return { status: 'missing', containerIds: [], diagnostics: [inspected.stderr.trim()] }
    }
    const states = inspected.stdout.split(/\s+/).filter(Boolean)
    const running = states.filter((state) => state === 'running').length
    return {
      status: running > 0 ? 'ready' : 'stopped',
      containerIds,
      diagnostics:
        running > 0 && running < states.length ? [`${states.length - running} Compose service(s) are stopped`] : [],
    }
  }

  async controlService(
    handle: EnvironmentHandle,
    service: { name: string },
    action: 'start' | 'stop' | 'restart',
  ): Promise<void> {
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: this.args(handle, [action, service.name]),
      cwd: handle.workspace.hostPath,
    })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim() || `Unable to ${action} ${service.name}`)
  }

  async stop(handle: EnvironmentHandle): Promise<void> {
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: this.args(handle, ['stop']),
      cwd: handle.workspace.hostPath,
    })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim())
  }

  async resume(handle: EnvironmentHandle): Promise<EnvironmentHandle> {
    const resolved: ResolvedEnvironment = {
      provider: this.id,
      configRef: typeof handle.providerRef.value.composeFile === 'string' ? handle.providerRef.value.composeFile : null,
      configHash: '',
      workspace: handle.workspace,
      capabilities: {
        exec: true,
        stdin: true,
        pty: false,
        resize: false,
        signals: true,
        reattach: false,
        services: true,
        rebuild: true,
      },
      security: {
        trusted: true,
        reasons: [],
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
    }
    return this.start(resolved, handle.scope)
  }

  async rebuild(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    previous?: EnvironmentHandle,
  ): Promise<EnvironmentHandle> {
    if (previous) await this.destroy(previous)
    return this.startStack(environment, scope, true)
  }

  async destroy(handle: EnvironmentHandle): Promise<void> {
    const project = handle.providerRef.value.composeProjectName
    if (typeof project !== 'string' || !project.startsWith('taskflow-')) {
      throw new Error('Refusing to remove a Compose project not owned by Taskflow')
    }
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: this.args(handle, ['down', '--remove-orphans']),
      cwd: handle.workspace.hostPath,
    })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim())
  }

  spawn(handle: EnvironmentHandle, command: EnvironmentCommand): EnvironmentCommandHandle {
    const containerId = handle.providerRef.value.containerId
    if (typeof containerId !== 'string' || !containerId) {
      throw new Error('Compose environment has no running container for command execution')
    }
    const running = this.runner.start({
      command: 'docker',
      args: ['exec', ...(command.stdin === 'pipe' ? ['-i'] : []), containerId, ...command.argv],
      cwd: handle.workspace.hostPath,
      keepStdinOpen: command.stdin === 'pipe',
      signal: command.signal,
      timeoutMs: command.timeoutMs,
    })
    return {
      pid: running.pid,
      stdout: running.stdout,
      stderr: running.stderr,
      exited: running.exited,
      write: (input) => running.writeStdin(input),
      closeStdin: () => running.closeStdin(),
      interrupt: async () => {
        running.kill('SIGINT')
      },
      kill: async () => {
        running.kill('SIGKILL')
      },
    }
  }

  terminalCommand(handle: EnvironmentHandle, command: string): string {
    return `cd ${quoteShell(handle.workspace.hostPath)} && ${command}`
  }

  executableShim(handle: EnvironmentHandle, executable: string): string {
    return this.host.executableShim(handle, executable)
  }

  terminalInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    const containerId = handle.providerRef.value.containerId
    if (typeof containerId !== 'string' || !containerId) {
      throw new Error('Compose environment has no running container for terminal access')
    }
    return {
      command: 'docker',
      args: ['exec', '-it', containerId, '/bin/sh'],
      cwd: handle.workspace.hostPath,
    }
  }

  logsInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return {
      command: 'docker',
      args: this.args(handle, ['logs', '--follow', '--tail', '100']),
      cwd: handle.workspace.hostPath,
    }
  }
}
