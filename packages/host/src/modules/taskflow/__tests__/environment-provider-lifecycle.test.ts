import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DevContainerProvider } from '../adapters/devcontainer-environment.ts'
import type { DockerGateway, LaunchContainerOpts } from '../adapters/docker.ts'
import { DockerComposeEnvironmentProvider } from '../adapters/docker-compose-environment.ts'
import { DockerEnvironmentProvider } from '../adapters/docker-environment.ts'
import { DockerfileEnvironmentProvider } from '../adapters/dockerfile-environment.ts'
import type { ProcessRunner, ProcessSpec, RunningProcess } from '../adapters/process-runner.ts'

function stream(value = ''): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (value) controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}

class LifecycleRunner implements ProcessRunner {
  readonly calls: ProcessSpec[] = []
  ownedId = ''
  composeConfig = '{"services":{}}'
  containerStates = 'running\n'
  /** What `git rev-parse --git-dir --git-common-dir` answers inside the workspace. */
  gitDirs: [string, string] | null = null

  start(spec: ProcessSpec): RunningProcess {
    this.calls.push(spec)
    let stdout = ''
    if (spec.command === 'git') stdout = this.gitDirs ? `${this.gitDirs[0]}\n${this.gitDirs[1]}\n` : ''
    else if (spec.args.includes('--version')) stdout = '0.89.0\n'
    else if (spec.args.includes('read-configuration')) {
      stdout = JSON.stringify({
        configuration: {},
        mergedConfiguration: { workspaceFolder: '/workspace', dockerComposeFile: '../compose.yaml' },
      })
    } else if (spec.command === 'docker' && spec.args[0] === 'compose' && spec.args.includes('ps')) stdout = 'primary\n'
    else if (spec.command === 'docker' && spec.args[0] === 'compose') stdout = this.composeConfig
    else if (spec.args.includes('up')) {
      stdout = JSON.stringify({
        containerId: 'primary',
        composeProjectName: 'tf_env',
        remoteWorkspaceFolder: '/workspace',
        mergedConfiguration: { dockerComposeFile: '../compose.yaml', forwardPorts: [8080] },
      })
    } else if (spec.command === 'docker' && spec.args[0] === 'ps') stdout = 'primary\nsidecar\n'
    else if (spec.command === 'docker' && spec.args[0] === 'network') stdout = ''
    else if (spec.command === 'docker' && spec.args[0] === 'inspect') {
      stdout = spec.args.some((arg) => arg.includes('taskflow.environment.id'))
        ? `${this.ownedId}\n`
        : this.containerStates
    }
    return {
      pid: 1,
      stdout: stream(stdout),
      stderr: stream(),
      exited: Promise.resolve({ code: 0, signal: null, timedOut: false }),
      writeStdin: async () => {},
      closeStdin: () => {},
      kill: () => true,
    }
  }
}

describe('environment provider lifecycle', () => {
  it('uses the official CLI for resolve/up and Docker only for owned stop/resume/destroy gaps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taskflow-provider-lifecycle-'))
    await mkdir(join(root, '.devcontainer'))
    await writeFile(join(root, '.devcontainer', 'devcontainer.json'), '{}')
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n')
    await writeFile(join(root, '.git'), 'gitdir: ../.git/worktrees/feature\n')
    const runner = new LifecycleRunner()
    runner.gitDirs = [join(root, '.git', 'worktrees', 'feature'), join(root, '.git')]
    const provider = new DevContainerProvider(runner, 'devcontainer')
    const scope = { installationId: 'install', projectId: 'project', workspaceId: 'workspace' }
    const resolved = await provider.resolve({ workspacePath: root, projectPath: root, scope })
    runner.composeConfig = '{"services":{"api":{"privileged":true}}}'
    const changed = await provider.resolve({ workspacePath: root, projectPath: root, scope })
    expect(changed.configHash).not.toBe(resolved.configHash)
    const handle = await provider.start(resolved, scope)
    runner.ownedId = handle.id
    await provider.stop(handle)
    await provider.resume(handle)
    await provider.destroy(handle)

    const cliCommands = runner.calls.filter((call) => call.command === 'devcontainer').flatMap((call) => call.args)
    expect(cliCommands).toContain('read-configuration')
    expect(cliCommands).toContain('up')
    expect(cliCommands).toContain('--mount-git-worktree-common-dir')
    expect(cliCommands).toContain('--mount')
    expect(cliCommands.some((arg) => arg.endsWith('target=/.git'))).toBe(true)
    expect(cliCommands).not.toContain('exec')
    expect(cliCommands).not.toContain('stop')
    expect(cliCommands).not.toContain('down')
    expect(runner.calls.some((call) => call.command === 'docker' && call.args[0] === 'stop')).toBe(true)
    expect(runner.calls.some((call) => call.command === 'docker' && call.args[0] === 'start')).toBe(true)
    expect(provider.logsInvocation(handle)).toEqual({
      command: 'docker',
      args: [
        'compose',
        '--project-name',
        'tf_env',
        '-f',
        join(root, 'compose.yaml'),
        'logs',
        '--follow',
        '--tail',
        '100',
      ],
      cwd: join(root, '.devcontainer'),
    })
  })

  it('labels Docker profile environments and verifies ownership before lifecycle mutations', async () => {
    const launched: LaunchContainerOpts[] = []
    const removed: string[] = []
    const docker: DockerGateway = {
      launchContainer: async (options) => {
        launched.push(options)
        return 'taskflow-workspace'
      },
      removeContainer: async (owner) => {
        removed.push(owner)
      },
    }
    const runner = new LifecycleRunner()
    const provider = new DockerEnvironmentProvider({
      projectRoot: '/repo',
      profiles: {
        sandbox: { runtime: 'docker', image: 'node:24', envPassthrough: [], panes: [] },
      },
      services: [],
      startupEnv: {},
      docker,
      runner,
    })
    const scope = { installationId: 'install', projectId: 'project', workspaceId: 'workspace' }
    const resolved = await provider.resolve({
      workspacePath: '/repo/worktree',
      projectPath: '/repo',
      scope,
      configRef: 'sandbox',
    })
    const handle = await provider.start(resolved, scope)
    runner.ownedId = handle.id
    expect(launched[0]?.environmentId).toBe(handle.id)
    await provider.stop(handle)
    await provider.resume(handle)
    await provider.destroy(handle)
    expect(removed).toEqual(['workspace'])
  })

  it('isolates Compose stacks with a deterministic Taskflow project name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taskflow-compose-provider-'))
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n')
    const runner = new LifecycleRunner()
    const provider = new DockerComposeEnvironmentProvider(runner)
    const scope = { installationId: 'install', projectId: 'project', workspaceId: 'workspace' }
    const resolved = await provider.resolve({ workspacePath: root, projectPath: root, scope })
    const handle = await provider.start(resolved, scope)

    expect(handle.provider).toBe('compose')
    expect(handle.providerRef.value.composeProjectName).toMatch(/^taskflow-/)
    expect(runner.calls.some((call) => call.args.includes('--project-name') && call.args.includes('up'))).toBe(true)

    runner.containerStates = 'exited\n'
    expect(await provider.inspect(handle)).toEqual({ status: 'stopped', containerIds: ['primary'], diagnostics: [] })
    runner.containerStates = 'running\n'
    expect(await provider.inspect(handle)).toEqual({ status: 'ready', containerIds: ['primary'], diagnostics: [] })

    await provider.controlService(handle, { name: 'api' }, 'restart')
    expect(
      runner.calls.some(
        (call) => call.command === 'docker' && call.args.includes('restart') && call.args.at(-1) === 'api',
      ),
    ).toBe(true)

    provider.spawn(handle, { argv: ['node', '-v'], stdin: 'pipe' })
    const exec = runner.calls.at(-1)
    expect(exec?.command).toBe('docker')
    expect(exec?.args).toEqual(['exec', '-i', 'primary', 'node', '-v'])
    expect(provider.terminalInvocation(handle)).toEqual({
      command: 'docker',
      args: ['exec', '-it', 'primary', '/bin/sh'],
      cwd: root,
    })

    await provider.destroy(handle)
    expect(runner.calls.some((call) => call.args.includes('down') && call.args.includes('--remove-orphans'))).toBe(true)
  })

  it('builds and runs Dockerfile environments without publishing host ports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taskflow-dockerfile-provider-'))
    await writeFile(join(root, 'Dockerfile'), 'FROM alpine\nEXPOSE 3000\n')
    const runner = new LifecycleRunner()
    const provider = new DockerfileEnvironmentProvider(runner)
    const scope = { installationId: 'install', projectId: 'project', workspaceId: 'workspace' }
    const resolved = await provider.resolve({ workspacePath: root, projectPath: root, scope })
    const handle = await provider.start(resolved, scope)

    expect(handle.provider).toBe('dockerfile')
    const run = runner.calls.find((call) => call.command === 'docker' && call.args[0] === 'run')
    expect(run?.args).toContain('--detach')
    expect(run?.args).toContain('--volume')
    expect(run?.args).not.toContain('-p')
    expect(runner.calls.some((call) => call.command === 'docker' && call.args[0] === 'build')).toBe(true)
  })
})
