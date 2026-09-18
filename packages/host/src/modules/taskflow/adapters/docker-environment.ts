import { createHash } from 'node:crypto'
import type {
  EnvironmentCommand,
  EnvironmentCommandHandle,
  EnvironmentHandle,
  EnvironmentScope,
  ProfileConfig,
  ResolvedEnvironment,
  ServiceSpec,
} from 'portta-core/taskflow'
import { environmentIdFor } from '../services/environment-coordinator.ts'
import { isDockerProfile } from './config.ts'
import type { DockerGateway } from './docker.ts'
import type {
  EnvironmentContext,
  EnvironmentProbe,
  EnvironmentProvider,
  ExecutionTransport,
  ObservedEnvironment,
} from './environment-provider.ts'
import { NodeProcessRunner, type ProcessRunner, runCaptured } from './process-runner.ts'

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export interface DockerEnvironmentProviderDependencies {
  projectRoot: string
  profiles: Record<string, ProfileConfig>
  services: ServiceSpec[]
  startupEnv: Record<string, string>
  docker: DockerGateway
  runner?: ProcessRunner
}

export class DockerEnvironmentProvider implements EnvironmentProvider, ExecutionTransport {
  readonly id = 'docker' as const
  readonly provider = 'docker' as const
  private readonly runner: ProcessRunner

  private readonly dependencies: DockerEnvironmentProviderDependencies
  constructor(dependencies: DockerEnvironmentProviderDependencies) {
    this.dependencies = dependencies
    this.runner = dependencies.runner ?? new NodeProcessRunner()
  }

  async probe(_context: EnvironmentContext): Promise<EnvironmentProbe> {
    const version = await runCaptured(this.runner, {
      command: 'docker',
      args: ['version', '--format', '{{.Client.Version}}'],
    })
    return {
      provider: this.id,
      available: version.exit.code === 0,
      configRefs: [],
      ...(version.exit.code === 0 ? { version: version.stdout.trim() } : {}),
      diagnostics: version.exit.code === 0 ? [] : [version.stderr.trim() || 'Docker is unavailable'],
    }
  }

  async resolve(context: EnvironmentContext): Promise<ResolvedEnvironment> {
    const profileName = context.configRef
    const profile = profileName ? this.dependencies.profiles[profileName] : undefined
    if (!profileName || !isDockerProfile(profile)) throw new Error('Docker environment requires a profile with image')
    const mounts = profile.mounts ?? []
    return {
      provider: this.id,
      configRef: profileName,
      configHash: createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
      workspace: { hostPath: context.workspacePath, containerPath: context.workspacePath },
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
        dockerSocket: mounts.some((mount) => (mount.guestPath ?? mount.hostPath) === '/var/run/docker.sock'),
        devices: false,
        broadMounts: mounts.some((mount) => mount.hostPath === '/' || mount.hostPath === '~'),
        features: [],
        unpinnedFeatures: [],
        addedCapabilities: [],
        securityOptions: [],
        secretKeys: [],
        isolationRisks: [],
      },
    }
  }

  private profile(environment: ResolvedEnvironment): ProfileConfig & { runtime: 'docker'; image: string } {
    const profile = environment.configRef ? this.dependencies.profiles[environment.configRef] : undefined
    if (!isDockerProfile(profile))
      throw new Error(`Docker profile is unavailable: ${environment.configRef ?? '(none)'}`)
    return profile
  }

  async start(environment: ResolvedEnvironment, scope: EnvironmentScope): Promise<EnvironmentHandle> {
    const ownerKey = scope.workspaceId
    const id = environmentIdFor(scope, this.id, environment.configRef)
    const containerName = await this.dependencies.docker.launchContainer({
      branch: ownerKey,
      wtDir: environment.workspace.hostPath,
      mainRepoDir: this.dependencies.projectRoot,
      sandboxConfig: this.profile(environment),
      services: [],
      runtimeEnv: this.dependencies.startupEnv,
      environmentId: id,
    })
    return {
      id,
      provider: this.id,
      scope,
      status: 'ready',
      workspace: environment.workspace,
      providerRef: { schemaVersion: 1, value: { containerName, ownerKey } },
    }
  }

  private containerName(handle: EnvironmentHandle): string {
    const value = handle.providerRef.value.containerName
    if (typeof value !== 'string' || !value) throw new Error(`Docker container is missing from ${handle.id}`)
    return value
  }

  private ownerKey(handle: EnvironmentHandle): string {
    const value = handle.providerRef.value.ownerKey
    return typeof value === 'string' && value ? value : handle.scope.workspaceId
  }

  async inspect(handle: EnvironmentHandle): Promise<ObservedEnvironment> {
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['inspect', '--format', '{{.State.Status}}', this.containerName(handle)],
    })
    if (result.exit.code !== 0) return { status: 'missing', containerIds: [], diagnostics: [result.stderr.trim()] }
    return {
      status: result.stdout.trim() === 'running' ? 'ready' : 'stopped',
      containerIds: [this.containerName(handle)],
      diagnostics: [],
    }
  }

  async stop(handle: EnvironmentHandle): Promise<void> {
    if (!(await this.isOwned(handle))) return
    const result = await runCaptured(this.runner, { command: 'docker', args: ['stop', this.containerName(handle)] })
    if (result.exit.code !== 0 && !result.stderr.includes('No such container')) throw new Error(result.stderr.trim())
  }

  async resume(handle: EnvironmentHandle): Promise<EnvironmentHandle> {
    if (!(await this.isOwned(handle)))
      throw new Error(`Refusing to start unowned container ${this.containerName(handle)}`)
    const result = await runCaptured(this.runner, { command: 'docker', args: ['start', this.containerName(handle)] })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim())
    return { ...handle, status: 'ready' }
  }

  async rebuild(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    previous?: EnvironmentHandle,
  ): Promise<EnvironmentHandle> {
    if (!previous || !(await this.isOwned(previous)))
      throw new Error('Docker rebuild requires an owned environment handle')
    await this.dependencies.docker.removeContainer(scope.workspaceId)
    return this.start(environment, scope)
  }

  async destroy(handle: EnvironmentHandle): Promise<void> {
    if (!(await this.isOwned(handle))) return
    await this.dependencies.docker.removeContainer(this.ownerKey(handle))
  }

  private async isOwned(handle: EnvironmentHandle): Promise<boolean> {
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['inspect', '--format', '{{index .Config.Labels "taskflow.environment.id"}}', this.containerName(handle)],
    })
    if (result.exit.code !== 0) return false
    if (result.stdout.trim() !== handle.id) {
      throw new Error(`Refusing to mutate unowned container ${this.containerName(handle)}`)
    }
    return true
  }

  spawn(handle: EnvironmentHandle, command: EnvironmentCommand): EnvironmentCommandHandle {
    const cwd =
      command.cwd === undefined || command.cwd === 'workspace'
        ? handle.workspace.containerPath
        : command.cwd.containerPath
    const running = this.runner.start({
      command: 'docker',
      args: [
        'exec',
        ...(command.stdin === 'pipe' ? ['-i'] : []),
        ...(cwd ? ['-w', cwd] : []),
        ...Object.entries(command.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        this.containerName(handle),
        ...command.argv,
      ],
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
    const workspace = handle.workspace.containerPath ?? handle.workspace.hostPath
    return `docker exec -it -w ${quoteShell(workspace)} ${quoteShell(this.containerName(handle))} /bin/sh -lc ${quoteShell(command)}`
  }

  executableShim(handle: EnvironmentHandle, executable: string): string {
    const workspace = handle.workspace.containerPath ?? handle.workspace.hostPath
    return `#!/bin/sh\ncwd="$PORTTA_FLOW_ENVIRONMENT_CWD"\n[ -n "$cwd" ] || cwd=${quoteShell(workspace)}\nexec docker exec -i -w "$cwd" ${quoteShell(this.containerName(handle))} ${quoteShell(executable)} "$@"\n`
  }

  terminalInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    const workspace = handle.workspace.containerPath ?? handle.workspace.hostPath
    return {
      command: 'docker',
      args: ['exec', '-it', '-w', workspace, this.containerName(handle), '/bin/sh', '-l'],
      cwd: handle.workspace.hostPath,
    }
  }

  logsInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return {
      command: 'docker',
      args: ['logs', '--follow', '--tail', '100', this.containerName(handle)],
      cwd: handle.workspace.hostPath,
    }
  }
}
