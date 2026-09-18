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
import { NodeProcessRunner, type ProcessRunner, runCaptured } from './process-runner.ts'

function dockerfileFor(context: EnvironmentContext): string {
  const dockerfile = resolve(context.workspacePath, context.configRef ?? 'Dockerfile')
  if (!existsSync(dockerfile)) throw new Error(`Dockerfile does not exist: ${context.configRef ?? 'Dockerfile'}`)
  return dockerfile
}

function imageTag(id: string): string {
  return `taskflow-dockerfile-${id.replace(/^env_/, '')}`
}

function containerName(id: string): string {
  return `taskflow-dockerfile-${id.replace(/^env_/, '')}`
}

function reference(handle: EnvironmentHandle, key: 'containerId' | 'imageTag' | 'dockerfile'): string {
  const value = handle.providerRef.value[key]
  if (typeof value !== 'string' || !value) throw new Error(`Dockerfile environment ${key} is missing`)
  return value
}

export class DockerfileEnvironmentProvider implements EnvironmentProvider, ExecutionTransport {
  readonly id = 'dockerfile' as const
  readonly provider = 'dockerfile' as const

  private readonly runner: ProcessRunner
  constructor(runner: ProcessRunner = new NodeProcessRunner()) {
    this.runner = runner
  }

  async probe(context: EnvironmentContext): Promise<EnvironmentProbe> {
    const version = await runCaptured(this.runner, {
      command: 'docker',
      args: ['version', '--format', '{{.Client.Version}}'],
    })
    const dockerfile = resolve(context.workspacePath, 'Dockerfile')
    return {
      provider: this.id,
      available: version.exit.code === 0 && existsSync(dockerfile),
      configRefs: existsSync(dockerfile) ? [dockerfile] : [],
      ...(version.exit.code === 0 ? { version: version.stdout.trim() } : {}),
      diagnostics:
        version.exit.code === 0
          ? existsSync(dockerfile)
            ? []
            : ['No Dockerfile was found']
          : [version.stderr.trim() || 'Docker is unavailable'],
    }
  }

  async resolve(context: EnvironmentContext): Promise<ResolvedEnvironment> {
    const dockerfile = dockerfileFor(context)
    const source = readFileSync(dockerfile, 'utf8')
    return {
      provider: this.id,
      configRef: dockerfile,
      configHash: createHash('sha256').update(source).digest('hex'),
      workspace: { hostPath: context.workspacePath, containerPath: '/workspace' },
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

  async start(environment: ResolvedEnvironment, scope: EnvironmentScope): Promise<EnvironmentHandle> {
    if (!environment.configRef) throw new Error('Dockerfile environment requires configRef')
    const id = environmentIdFor(scope, this.id, environment.configRef)
    const tag = imageTag(id)
    const name = containerName(id)
    const build = await runCaptured(this.runner, {
      command: 'docker',
      args: [
        'build',
        '--file',
        environment.configRef,
        '--tag',
        tag,
        '--label',
        `taskflow.environment.id=${id}`,
        environment.workspace.hostPath,
      ],
      cwd: environment.workspace.hostPath,
    })
    if (build.exit.code !== 0) throw new Error(build.stderr.trim() || 'Dockerfile build failed')
    const run = await runCaptured(this.runner, {
      command: 'docker',
      args: [
        'run',
        '--detach',
        '--name',
        name,
        '--label',
        `taskflow.environment.id=${id}`,
        '--volume',
        `${environment.workspace.hostPath}:/workspace`,
        tag,
      ],
      cwd: environment.workspace.hostPath,
    })
    if (run.exit.code !== 0) throw new Error(run.stderr.trim() || 'Dockerfile container failed to start')
    return {
      id,
      provider: this.id,
      scope,
      status: 'ready',
      workspace: environment.workspace,
      providerRef: {
        schemaVersion: 1,
        value: { containerId: run.stdout.trim() || name, imageTag: tag, dockerfile: environment.configRef },
      },
    }
  }

  async inspect(handle: EnvironmentHandle): Promise<ObservedEnvironment> {
    const id = reference(handle, 'containerId')
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['inspect', '--format', '{{.State.Status}}', id],
    })
    if (result.exit.code !== 0) return { status: 'missing', containerIds: [], diagnostics: [result.stderr.trim()] }
    return { status: result.stdout.trim() === 'running' ? 'ready' : 'stopped', containerIds: [id], diagnostics: [] }
  }

  async stop(handle: EnvironmentHandle): Promise<void> {
    if (!(await this.isOwned(handle))) return
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['stop', reference(handle, 'containerId')],
    })
    if (result.exit.code !== 0 && !result.stderr.includes('No such container')) throw new Error(result.stderr.trim())
  }

  async resume(handle: EnvironmentHandle): Promise<EnvironmentHandle> {
    if (!(await this.isOwned(handle)))
      throw new Error(`Refusing to start unowned container ${reference(handle, 'containerId')}`)
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['start', reference(handle, 'containerId')],
    })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim())
    return { ...handle, status: 'ready' }
  }

  async rebuild(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    previous?: EnvironmentHandle,
  ): Promise<EnvironmentHandle> {
    if (previous) await this.destroy(previous)
    return this.start(environment, scope)
  }

  async destroy(handle: EnvironmentHandle): Promise<void> {
    if (!(await this.isOwned(handle))) return
    const removed = await runCaptured(this.runner, {
      command: 'docker',
      args: ['rm', '--force', reference(handle, 'containerId')],
    })
    if (removed.exit.code !== 0 && !removed.stderr.includes('No such container')) throw new Error(removed.stderr.trim())
    await runCaptured(this.runner, { command: 'docker', args: ['image', 'rm', reference(handle, 'imageTag')] })
  }

  private async isOwned(handle: EnvironmentHandle): Promise<boolean> {
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: [
        'inspect',
        '--format',
        '{{index .Config.Labels "taskflow.environment.id"}}',
        reference(handle, 'containerId'),
      ],
    })
    if (result.exit.code !== 0) return false
    if (result.stdout.trim() !== handle.id)
      throw new Error(`Refusing to mutate unowned container ${reference(handle, 'containerId')}`)
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
        reference(handle, 'containerId'),
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
    return `docker exec -it -w /workspace ${reference(handle, 'containerId')} /bin/sh -lc ${JSON.stringify(command)}`
  }

  executableShim(handle: EnvironmentHandle, executable: string): string {
    return `#!/bin/sh\nexec docker exec -i -w /workspace ${reference(handle, 'containerId')} ${JSON.stringify(executable)} "$@"\n`
  }

  terminalInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return {
      command: 'docker',
      args: ['exec', '-it', '-w', '/workspace', reference(handle, 'containerId'), '/bin/sh', '-l'],
      cwd: handle.workspace.hostPath,
    }
  }

  logsInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return {
      command: 'docker',
      args: ['logs', '--follow', '--tail', '100', reference(handle, 'containerId')],
      cwd: handle.workspace.hostPath,
    }
  }
}
