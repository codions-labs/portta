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
import { NodeProcessRunner, type ProcessRunner } from './process-runner.ts'

const capabilities = {
  exec: true,
  stdin: true,
  pty: false,
  resize: false,
  signals: true,
  reattach: false,
  services: true,
  rebuild: false,
} as const

export class HostEnvironmentProvider implements EnvironmentProvider, ExecutionTransport {
  readonly id = 'host' as const
  readonly provider = 'host' as const

  private readonly runner: ProcessRunner
  constructor(runner: ProcessRunner = new NodeProcessRunner()) {
    this.runner = runner
  }

  async probe(_context: EnvironmentContext): Promise<EnvironmentProbe> {
    return { provider: this.id, available: true, configRefs: [], diagnostics: [] }
  }

  async resolve(context: EnvironmentContext): Promise<ResolvedEnvironment> {
    return {
      provider: this.id,
      configRef: null,
      configHash: 'host',
      workspace: { hostPath: context.workspacePath },
      capabilities,
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
    return {
      id: environmentIdFor(scope, 'host', null),
      provider: this.id,
      scope,
      status: 'ready',
      workspace: environment.workspace,
      providerRef: { schemaVersion: 1, value: {} },
    }
  }

  async inspect(_handle: EnvironmentHandle): Promise<ObservedEnvironment> {
    return { status: 'ready', containerIds: [], diagnostics: [] }
  }

  async stop(_handle: EnvironmentHandle): Promise<void> {}

  async resume(handle: EnvironmentHandle): Promise<EnvironmentHandle> {
    return { ...handle, status: 'ready' }
  }

  async rebuild(environment: ResolvedEnvironment, scope: EnvironmentScope): Promise<EnvironmentHandle> {
    return this.start(environment, scope)
  }

  async destroy(_handle: EnvironmentHandle): Promise<void> {}

  spawn(handle: EnvironmentHandle, command: EnvironmentCommand): EnvironmentCommandHandle {
    const cwd =
      command.cwd === undefined || command.cwd === 'workspace' ? handle.workspace.hostPath : command.cwd.containerPath
    const running = this.runner.start({
      command: command.argv[0],
      args: command.argv.slice(1),
      cwd,
      env: command.env,
      keepStdinOpen: command.stdin === 'pipe',
      signal: command.signal,
      timeoutMs: command.timeoutMs,
    })
    return {
      pid: running.pid,
      stdout: running.stdout,
      stderr: running.stderr,
      exited: running.exited.then((exit) => ({ ...exit, signal: exit.signal })),
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

  terminalCommand(_handle: EnvironmentHandle, command: string): string {
    return command
  }

  executableShim(_handle: EnvironmentHandle, executable: string): string {
    return `#!/bin/sh\nexec ${JSON.stringify(executable)} "$@"\n`
  }

  terminalInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return { command: process.env.SHELL || '/bin/bash', args: ['-l'], cwd: handle.workspace.hostPath }
  }

  logsInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return {
      command: process.env.SHELL || '/bin/bash',
      args: ['-lc', "echo 'Host environment: Taskflow does not own a runtime log stream.'"],
      cwd: handle.workspace.hostPath,
    }
  }
}
