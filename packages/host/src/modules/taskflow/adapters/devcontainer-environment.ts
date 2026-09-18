import { createHash } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import type {
  EnvironmentCommand,
  EnvironmentCommandHandle,
  EnvironmentHandle,
  EnvironmentScope,
  EnvironmentSecurityAssessment,
  ResolvedEnvironment,
} from 'portta-core/taskflow'
import { z } from 'zod'
import { environmentIdFor } from '../services/environment-coordinator.ts'
import { buildIsolationReport } from '../services/environment-isolation.ts'
import type {
  EnvironmentContext,
  EnvironmentProbe,
  EnvironmentProvider,
  ExecutionTransport,
  ObservedEnvironment,
} from './environment-provider.ts'
import { NodeProcessRunner, type ProcessRunner, runCaptured } from './process-runner.ts'
import { worktreeGitMountArgs } from './worktree-git-mount.ts'

const cliOutputSchema = z.object({
  containerId: z.string(),
  composeProjectName: z.string().optional(),
  remoteUser: z.string().optional(),
  remoteWorkspaceFolder: z.string(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  mergedConfiguration: z.record(z.string(), z.unknown()).optional(),
})

const readOutputSchema = z.object({
  configuration: z.record(z.string(), z.unknown()).optional(),
  mergedConfiguration: z.record(z.string(), z.unknown()).optional(),
})
const SUPPORTED_CLI_VERSION = '0.89.0'
const LOCAL_HOME_VARIABLE = '$' + '{localEnv:HOME}'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function findDevcontainerConfigs(workspacePath: string): Promise<string[]> {
  const rootConfig = join(workspacePath, '.devcontainer.json')
  const directory = join(workspacePath, '.devcontainer')
  const configs: string[] = []
  if (await exists(rootConfig)) configs.push(rootConfig)
  if (await exists(join(directory, 'devcontainer.json'))) configs.push(join(directory, 'devcontainer.json'))
  if (await exists(directory)) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(directory, entry.name, 'devcontainer.json')
      if (await exists(candidate)) configs.push(candidate)
    }
  }
  return [...new Set(configs)].sort()
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? z.record(z.string(), z.unknown()).parse(value)
    : {}
}

function mountText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function discoveryConfiguration(configuration: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'appPort',
    'dockerComposeFile',
    'forwardPorts',
    'otherPortsAttributes',
    'portsAttributes',
    'runServices',
    'service',
  ]
  return Object.fromEntries(
    keys.flatMap((key) => (configuration[key] === undefined ? [] : [[key, configuration[key]]])),
  )
}

export interface DevcontainerSecurityOptions {
  featuresLocked?: boolean
  isolationRisks?: string[]
}

function optionValues(args: string[], name: string): string[] {
  return args.flatMap((arg, index) => {
    if (arg === name) return args[index + 1] ? [String(args[index + 1])] : []
    return arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []
  })
}

export function assessDevcontainerSecurity(
  configuration: Record<string, unknown>,
  options: DevcontainerSecurityOptions = {},
): EnvironmentSecurityAssessment {
  const merged = record(configuration.mergedConfiguration ?? configuration.configuration ?? configuration)
  const configuredMounts = Array.isArray(merged.mounts) ? merged.mounts : []
  const mounts = configuredMounts.map(mountText)
  const features = Object.keys(record(merged.features))
  const runArgs = Array.isArray(merged.runArgs) ? merged.runArgs.map(String) : []
  const addedCapabilities = [
    ...optionValues(runArgs, '--cap-add'),
    ...(Array.isArray(merged.capAdd) ? merged.capAdd.map(String) : []),
  ]
  const securityOptions = [
    ...optionValues(runArgs, '--security-opt'),
    ...(Array.isArray(merged.securityOpt) ? merged.securityOpt.map(String) : []),
  ]
  const secretKeys = [
    ...Object.keys(record(merged.containerEnv)),
    ...Object.keys(record(merged.remoteEnv)),
    ...Object.keys(record(merged.secrets)),
  ].filter((key) => /(secret|token|password|credential|private.?key)/i.test(key))
  const unpinnedFeatures = options.featuresLocked ? [] : features.filter((feature) => !feature.includes('@sha256:'))
  const dockerSocket = mounts.some((mount) => mount.includes('/var/run/docker.sock'))
  const broadMounts = configuredMounts.some((mount) => {
    const source = record(mount).source
    return (
      source === '/' ||
      source === '~' ||
      source === LOCAL_HOME_VARIABLE ||
      /source=(\/|~|\$\{localEnv:HOME\})[,;]/.test(mountText(mount))
    )
  })
  const assessment = {
    trusted: false,
    reasons: [] as string[],
    initializeCommand: merged.initializeCommand !== undefined,
    privileged: merged.privileged === true,
    dockerSocket,
    devices: runArgs.some((arg) => arg.includes('--device')),
    broadMounts,
    features,
    unpinnedFeatures,
    addedCapabilities,
    securityOptions,
    secretKeys,
    isolationRisks: options.isolationRisks ?? [],
  }
  if (assessment.initializeCommand) assessment.reasons.push('initializeCommand executes on the host')
  if (assessment.privileged) assessment.reasons.push('privileged container requested')
  if (assessment.dockerSocket) assessment.reasons.push('Docker socket mount requested')
  if (assessment.devices) assessment.reasons.push('host device access requested')
  if (assessment.broadMounts) assessment.reasons.push('broad host mount requested')
  if (assessment.features.length > 0) assessment.reasons.push('Features execute supply-chain code')
  if (assessment.unpinnedFeatures.length > 0)
    assessment.reasons.push(`Unpinned Features: ${assessment.unpinnedFeatures.join(', ')}`)
  if (assessment.addedCapabilities.length > 0)
    assessment.reasons.push(`Linux capabilities requested: ${assessment.addedCapabilities.join(', ')}`)
  if (assessment.securityOptions.length > 0)
    assessment.reasons.push(`Container security options requested: ${assessment.securityOptions.join(', ')}`)
  if (assessment.secretKeys.length > 0)
    assessment.reasons.push(`Potential secret environment values: ${assessment.secretKeys.join(', ')}`)
  if (assessment.isolationRisks.length > 0)
    assessment.reasons.push(`Compose isolation risks: ${assessment.isolationRisks.join('; ')}`)
  return assessment
}

async function resolveComposeConfiguration(
  runner: ProcessRunner,
  config: string,
  merged: Record<string, unknown>,
): Promise<{ hashMaterial: string; risks: string[] }> {
  const configured = merged.dockerComposeFile
  const files = Array.isArray(configured)
    ? configured.filter((value): value is string => typeof value === 'string')
    : typeof configured === 'string'
      ? [configured]
      : []
  if (files.length === 0) return { hashMaterial: '', risks: [] }
  const args = [
    'compose',
    ...files.flatMap((file) => ['-f', resolve(dirname(config), file)]),
    'config',
    '--format',
    'json',
  ]
  const effective = await runCaptured(runner, { command: 'docker', args, cwd: dirname(config) })
  if (effective.exit.code !== 0) {
    return {
      hashMaterial: effective.stderr,
      risks: [`effective Compose configuration could not be validated: ${effective.stderr.trim()}`],
    }
  }
  const report = buildIsolationReport(JSON.parse(effective.stdout))
  return {
    hashMaterial: effective.stdout,
    risks: report.risks.map((risk) => `${risk.kind}:${risk.resource}:${risk.detail}`),
  }
}

export class DevContainerProvider implements EnvironmentProvider, ExecutionTransport {
  readonly id = 'devcontainer' as const
  readonly provider = 'devcontainer' as const

  private readonly cli: string
  private readonly cliPrefix: string[]
  private readonly workspaceFolders = new Map<string, string>()
  private readonly workspaceMounts = new Map<string, string>()

  private readonly runner: ProcessRunner
  constructor(runner: ProcessRunner = new NodeProcessRunner(), cli?: string) {
    this.runner = runner
    if (cli) {
      this.cli = cli
      this.cliPrefix = []
      return
    }
    const packagePath = createRequire(import.meta.url).resolve('@devcontainers/cli/package.json')
    this.cli = process.execPath
    this.cliPrefix = [join(dirname(packagePath), 'devcontainer.js')]
  }

  private args(args: string[]): string[] {
    return [...this.cliPrefix, ...args]
  }

  private async version(): Promise<{ supported: boolean; version: string; diagnostic: string | null }> {
    const result = await runCaptured(this.runner, { command: this.cli, args: this.args(['--version']) })
    const version = result.stdout.trim()
    if (result.exit.code !== 0)
      return { supported: false, version: '', diagnostic: result.stderr.trim() || 'CLI not found' }
    return version === SUPPORTED_CLI_VERSION
      ? { supported: true, version, diagnostic: null }
      : {
          supported: false,
          version,
          diagnostic: `Unsupported Dev Containers CLI ${version}; expected ${SUPPORTED_CLI_VERSION}`,
        }
  }

  async probe(context: EnvironmentContext): Promise<EnvironmentProbe> {
    const configs = await findDevcontainerConfigs(context.workspacePath)
    const version = await this.version()
    return {
      provider: this.id,
      available: version.supported,
      configRefs: configs.map((config) => relative(context.workspacePath, config)),
      ...(version.version ? { version: version.version } : {}),
      diagnostics: version.diagnostic ? [version.diagnostic] : [],
    }
  }

  private async configFor(context: EnvironmentContext): Promise<string> {
    const configs = await findDevcontainerConfigs(context.workspacePath)
    if (context.configRef) {
      const selected = resolve(context.workspacePath, context.configRef)
      if (!configs.includes(selected)) throw new Error(`Dev Container config was not found: ${context.configRef}`)
      return selected
    }
    if (configs.length === 0) throw new Error('No Dev Container configuration was found')
    if (configs.length > 1)
      throw new Error('Multiple Dev Container configurations found; select profile.environment.config')
    const selected = configs[0]
    if (selected === undefined) throw new Error('No Dev Container configuration was found')
    return selected
  }

  async resolve(context: EnvironmentContext): Promise<ResolvedEnvironment> {
    const version = await this.version()
    if (!version.supported) throw new Error(version.diagnostic ?? 'Dev Containers CLI is unavailable')
    const config = await this.configFor(context)
    const result = await runCaptured(this.runner, {
      command: this.cli,
      args: this.args([
        'read-configuration',
        '--workspace-folder',
        context.workspacePath,
        '--config',
        config,
        '--include-features-configuration',
        '--include-merged-configuration',
      ]),
      cwd: context.workspacePath,
    })
    if (result.exit.code !== 0) throw new Error(`devcontainer read-configuration failed: ${result.stderr.trim()}`)
    const raw = readOutputSchema.parse(JSON.parse(result.stdout))
    const rawConfig = await readFile(config, 'utf8')
    const merged = record(raw.mergedConfiguration ?? raw.configuration)
    if (typeof merged.workspaceFolder === 'string') this.workspaceFolders.set(config, merged.workspaceFolder)
    if (typeof merged.workspaceMount === 'string' && merged.workspaceMount.trim().length > 0)
      this.workspaceMounts.set(config, merged.workspaceMount)
    else this.workspaceMounts.delete(config)
    const compose = await resolveComposeConfiguration(this.runner, config, merged)
    const lockfile = join(dirname(config), 'devcontainer-lock.json')
    const lockfileExists = await exists(lockfile)
    const lockfileContents = lockfileExists ? await readFile(lockfile, 'utf8') : ''
    return {
      provider: this.id,
      configRef: relative(context.workspacePath, config),
      configHash: hash(`${rawConfig}\0${result.stdout}\0${compose.hashMaterial}\0${lockfileContents}`),
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
      security: assessDevcontainerSecurity(raw, { featuresLocked: lockfileExists, isolationRisks: compose.risks }),
    }
  }

  private async up(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    removeExisting: boolean,
  ): Promise<EnvironmentHandle> {
    if (!environment.configRef) throw new Error('Dev Container environment requires configRef')
    const config = resolve(environment.workspace.hostPath, environment.configRef)
    const id = environmentIdFor(scope, 'devcontainer', environment.configRef)
    const composeName = `tf_${id.slice(4)}`
    const gitArgs = await worktreeGitMountArgs({
      runner: this.runner,
      workspacePath: environment.workspace.hostPath,
      containerWorkspacePath: this.workspaceFolders.get(config),
      workspaceMount: this.workspaceMounts.get(config),
      configRef: environment.configRef,
    })
    const result = await runCaptured(this.runner, {
      command: this.cli,
      args: this.args([
        'up',
        '--workspace-folder',
        environment.workspace.hostPath,
        '--config',
        config,
        '--id-label',
        `taskflow.environment.id=${id}`,
        '--include-configuration',
        '--include-merged-configuration',
        ...gitArgs,
        ...(removeExisting ? ['--remove-existing-container'] : []),
      ]),
      cwd: dirname(config),
      env: { COMPOSE_PROJECT_NAME: composeName },
    })
    if (result.exit.code !== 0) throw new Error(`devcontainer up failed: ${result.stderr.trim()}`)
    const output = cliOutputSchema.parse(JSON.parse(result.stdout))
    return {
      id,
      provider: this.id,
      scope,
      status: 'ready',
      workspace: { hostPath: environment.workspace.hostPath, containerPath: output.remoteWorkspaceFolder },
      providerRef: {
        schemaVersion: 1,
        value: {
          containerId: output.containerId,
          composeProjectName: output.composeProjectName ?? composeName,
          remoteUser: output.remoteUser ?? '',
          configRef: environment.configRef,
          configuration: discoveryConfiguration(output.configuration ?? {}),
          mergedConfiguration: discoveryConfiguration(output.mergedConfiguration ?? output.configuration ?? {}),
        },
      },
    }
  }

  async start(environment: ResolvedEnvironment, scope: EnvironmentScope): Promise<EnvironmentHandle> {
    return this.up(environment, scope, false)
  }

  private containerId(handle: EnvironmentHandle): string {
    return z.string().parse(handle.providerRef.value.containerId)
  }

  async inspect(handle: EnvironmentHandle): Promise<ObservedEnvironment> {
    const id = this.containerId(handle)
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['inspect', '--format', '{{.State.Status}}', id],
    })
    if (result.exit.code !== 0) return { status: 'missing', containerIds: [], diagnostics: [result.stderr.trim()] }
    return { status: result.stdout.trim() === 'running' ? 'ready' : 'stopped', containerIds: [id], diagnostics: [] }
  }

  async stop(handle: EnvironmentHandle): Promise<void> {
    if (!(await this.isOwned(handle))) return
    const ids = await this.composeContainerIds(handle)
    if (ids.length === 0) return
    const result = await runCaptured(this.runner, { command: 'docker', args: ['stop', ...ids] })
    if (result.exit.code !== 0 && !result.stderr.includes('No such container')) throw new Error(result.stderr.trim())
  }

  async resume(handle: EnvironmentHandle): Promise<EnvironmentHandle> {
    if (!(await this.isOwned(handle)))
      throw new Error(`Refusing to start unowned container ${this.containerId(handle)}`)
    const ids = await this.composeContainerIds(handle)
    if (ids.length === 0) throw new Error('Dev Container resources are missing')
    const result = await runCaptured(this.runner, { command: 'docker', args: ['start', ...ids] })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim())
    return { ...handle, status: 'ready' }
  }

  async controlService(
    handle: EnvironmentHandle,
    service: { name: string; containerIds: string[] },
    action: 'start' | 'stop' | 'restart',
  ): Promise<void> {
    if (!(await this.isOwned(handle))) throw new Error('Dev Container environment is not owned by Taskflow')
    const ownedIds = new Set(await this.composeContainerIds(handle))
    const ids = service.containerIds.filter((id) => ownedIds.has(id))
    if (ids.length === 0) throw new Error(`No owned container was found for ${service.name}`)
    const result = await runCaptured(this.runner, { command: 'docker', args: [action, ...ids] })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim() || `Unable to ${action} ${service.name}`)
  }

  async rebuild(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    previous?: EnvironmentHandle,
  ): Promise<EnvironmentHandle> {
    if (!previous || !(await this.isOwned(previous)))
      throw new Error('Dev Container rebuild requires an owned environment handle')
    return this.up(environment, scope, true)
  }

  private composeProject(handle: EnvironmentHandle): string | null {
    const value = handle.providerRef.value.composeProjectName
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  private async composeContainerIds(handle: EnvironmentHandle): Promise<string[]> {
    const project = this.composeProject(handle)
    if (!project) return [this.containerId(handle)]
    const result = await runCaptured(this.runner, {
      command: 'docker',
      args: ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${project}`],
    })
    if (result.exit.code !== 0) throw new Error(result.stderr.trim())
    return result.stdout.split(/\s+/).filter(Boolean)
  }

  async destroy(handle: EnvironmentHandle): Promise<void> {
    if (!(await this.isOwned(handle))) return
    const ids = await this.composeContainerIds(handle)
    const result =
      ids.length === 0 ? null : await runCaptured(this.runner, { command: 'docker', args: ['rm', '--force', ...ids] })
    if (result && result.exit.code !== 0 && !result.stderr.includes('No such container'))
      throw new Error(result.stderr.trim())
    const composeProject = this.composeProject(handle)
    if (!composeProject) return
    const networks = await runCaptured(this.runner, {
      command: 'docker',
      args: ['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${composeProject}`],
    })
    const networkIds = networks.stdout.split(/\s+/).filter(Boolean)
    if (networkIds.length === 0) return
    const networkRemoval = await runCaptured(this.runner, {
      command: 'docker',
      args: ['network', 'rm', ...networkIds],
    })
    if (networkRemoval.exit.code !== 0 && !networkRemoval.stderr.includes('No such network')) {
      throw new Error(networkRemoval.stderr.trim())
    }
  }

  private async isOwned(handle: EnvironmentHandle): Promise<boolean> {
    const id = this.containerId(handle)
    const label = await runCaptured(this.runner, {
      command: 'docker',
      args: ['inspect', '--format', '{{index .Config.Labels "taskflow.environment.id"}}', id],
    })
    if (label.exit.code !== 0) return false
    if (label.stdout.trim() !== handle.id) {
      throw new Error(`Refusing to mutate unowned container ${id}`)
    }
    return true
  }

  spawn(handle: EnvironmentHandle, command: EnvironmentCommand): EnvironmentCommandHandle {
    const args = [
      'exec',
      '--container-id',
      this.containerId(handle),
      ...Object.entries(command.env ?? {}).flatMap(([key, value]) => ['--remote-env', `${key}=${value}`]),
      '--',
      ...command.argv,
    ]
    const running = this.runner.start({
      command: this.cli,
      args: this.args(args),
      cwd: handle.workspace.hostPath,
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

  terminalCommand(handle: EnvironmentHandle, command: string): string {
    const workspace = handle.workspace.containerPath
    const inner = workspace ? `cd ${quoteShell(workspace)} && exec /bin/sh -lc ${quoteShell(command)}` : command
    return [
      quoteShell(this.cli),
      ...this.args(['exec', '--container-id', this.containerId(handle), '--', '/bin/sh', '-lc', inner]).map(quoteShell),
    ].join(' ')
  }

  executableShim(handle: EnvironmentHandle, executable: string): string {
    const workspace = handle.workspace.containerPath ?? handle.workspace.hostPath
    const argv = [
      this.cli,
      ...this.args([
        'exec',
        '--container-id',
        this.containerId(handle),
        '--',
        '/bin/sh',
        '-c',
        'cd "$1" && shift && exec "$@"',
        'sh',
      ]),
    ].map(quoteShell)
    return `#!/bin/sh\ncwd="$PORTTA_FLOW_ENVIRONMENT_CWD"\n[ -n "$cwd" ] || cwd=${quoteShell(workspace)}\nexec ${argv.join(' ')} "$cwd" ${quoteShell(executable)} "$@"\n`
  }

  terminalInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    return {
      command: this.cli,
      args: this.args(['exec', '--container-id', this.containerId(handle), '--', '/bin/sh', '-l']),
      cwd: handle.workspace.hostPath,
    }
  }

  logsInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string } {
    const project = this.composeProject(handle)
    const configRef = handle.providerRef.value.configRef
    const configuration = record(handle.providerRef.value.mergedConfiguration)
    const configuredFiles = configuration.dockerComposeFile
    const files = Array.isArray(configuredFiles)
      ? configuredFiles.filter((value): value is string => typeof value === 'string')
      : typeof configuredFiles === 'string'
        ? [configuredFiles]
        : []
    if (project && typeof configRef === 'string' && files.length > 0) {
      const configDirectory = dirname(resolve(handle.workspace.hostPath, configRef))
      return {
        command: 'docker',
        args: [
          'compose',
          '--project-name',
          project,
          ...files.flatMap((file) => ['-f', resolve(configDirectory, file)]),
          'logs',
          '--follow',
          '--tail',
          '100',
        ],
        cwd: configDirectory,
      }
    }
    return {
      command: 'docker',
      args: ['logs', '--follow', '--tail', '100', this.containerId(handle)],
      cwd: handle.workspace.hostPath,
    }
  }
}
