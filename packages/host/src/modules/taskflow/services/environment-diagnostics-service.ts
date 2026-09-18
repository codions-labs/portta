import type { DiagnosticCheck, DiagnosticsResponse } from 'portta-contracts/taskflow'
import type { ProjectConfig } from 'portta-core/taskflow'
import { codexHelpSupportsAutoReview } from '../adapters/agent-capabilities.ts'
import { NodeProcessRunner, type ProcessRunner } from '../adapters/process-runner.ts'
import { resolveHostToolThoroughly } from '../lib/host-tools.ts'

const PROBE_TIMEOUT_MS = 15_000
const DOCKER_AGENT_PATH = '/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin'

interface CommandResult {
  ok: boolean
  output: string
}

export interface EnvironmentDiagnosticsDependencies {
  config: ProjectConfig
  processRunner?: ProcessRunner
  resolveTool?: (command: string) => string | null
  linearProbe?: () => Promise<{ ok: true } | { ok: false; error: string }>
  now?: () => Date
}

function check(
  id: string,
  label: string,
  status: DiagnosticCheck['status'],
  required: boolean,
  summary: string,
  remediation: string | null = null,
): DiagnosticCheck {
  return { id, label, status, required, summary, remediation }
}

export class EnvironmentDiagnosticsService {
  private readonly processRunner: ProcessRunner
  private readonly now: () => Date

  private readonly deps: EnvironmentDiagnosticsDependencies
  constructor(deps: EnvironmentDiagnosticsDependencies) {
    this.deps = deps
    this.processRunner = deps.processRunner ?? new NodeProcessRunner()
    this.now = deps.now ?? (() => new Date())
  }

  async run(): Promise<DiagnosticsResponse> {
    const checks: DiagnosticCheck[] = [
      check('node', 'Node.js', 'ok', true, `Node ${process.version}`),
      await this.commandCheck('git', 'Git', true, 'git', ['--version'], 'Install Git and ensure it is on PATH'),
      await this.commandCheck(
        'multiplexer',
        'Terminal multiplexer',
        true,
        this.deps.config.multiplexer,
        this.deps.config.multiplexer === 'tmux' ? ['-V'] : ['--version'],
        `Install ${this.deps.config.multiplexer} and ensure it is on PATH`,
      ),
      await this.agentCheck(),
      await this.codexAutoReviewCheck(),
      await this.githubCheck(),
      await this.linearCheck(),
      ...(await this.dockerChecks()),
    ]

    return {
      ready: !checks.some((item) => item.required && item.status === 'error'),
      checkedAt: this.now().toISOString(),
      checks,
    }
  }

  private resolveCommand(command: string): string | null {
    return this.deps.resolveTool ? this.deps.resolveTool(command) : resolveHostToolThoroughly(command)
  }

  private async runCommand(command: string, args: string[]): Promise<CommandResult> {
    const process = this.processRunner.start({ command, args, timeoutMs: PROBE_TIMEOUT_MS })
    const [exit, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    return {
      ok: exit.code === 0 && !exit.timedOut,
      output: stdout.trim() || stderr.trim(),
    }
  }

  private async commandCheck(
    id: string,
    label: string,
    required: boolean,
    command: string,
    args: string[],
    remediation: string,
  ): Promise<DiagnosticCheck> {
    const resolved = this.resolveCommand(command)
    if (!resolved) {
      return check(id, label, 'error', required, `${command} is unavailable`, remediation)
    }
    const result = await this.runCommand(resolved, args)
    const summary = result.output.split('\n')[0] ?? ''
    if (result.ok) return check(id, label, 'ok', required, summary || `${command} is available`)
    return check(
      id,
      label,
      required ? 'error' : 'warning',
      required,
      `${command} was found but \`${command} ${args.join(' ')}\` failed`,
      remediation,
    )
  }

  private async agentCheck(): Promise<DiagnosticCheck> {
    const agent = this.deps.config.workspace.defaultAgent
    if (agent !== 'codex' && agent !== 'claude') {
      return check('agent', 'Default agent', 'warning', false, `Custom agent ${agent} requires runtime validation`)
    }
    return this.commandCheck(
      'agent',
      'Default agent',
      true,
      agent,
      ['--version'],
      `Install ${agent} and authenticate it before launching worktrees`,
    )
  }

  private async codexAutoReviewCheck(): Promise<DiagnosticCheck> {
    const required = this.deps.config.workspace.defaultAgent === 'codex'
    const resolved = this.resolveCommand('codex')
    if (!resolved) {
      return check(
        'codex-auto-review',
        'Codex oneshot',
        required ? 'error' : 'warning',
        required,
        'Automatic approval review is unavailable',
        'Install Codex CLI and ensure it is on PATH',
      )
    }
    const result = await this.runCommand(resolved, ['--help'])
    if (result.ok && codexHelpSupportsAutoReview(result.output)) {
      return check('codex-auto-review', 'Codex oneshot', 'ok', required, 'Automatic approval review is supported')
    }
    return check(
      'codex-auto-review',
      'Codex oneshot',
      required ? 'error' : 'warning',
      required,
      'Automatic approval review is unavailable',
      'Update Codex CLI to a release that supports --approve-for-me',
    )
  }

  private async githubCheck(): Promise<DiagnosticCheck> {
    const configured =
      this.deps.config.integrations.github.linkedRepos.length > 0 ||
      this.deps.config.integrations.github.autoRemoveOnMerge
    if (!configured) return check('github', 'GitHub', 'skipped', false, 'Integration is not configured')

    const gh = this.resolveCommand('gh')
    if (!gh) {
      return check('github', 'GitHub', 'error', true, 'GitHub CLI is unavailable', 'Install gh and run gh auth login')
    }
    const auth = await this.runCommand(gh, ['auth', 'status'])
    if (!auth.ok) {
      return check('github', 'GitHub', 'error', true, 'GitHub CLI is not authenticated', 'Run gh auth login')
    }
    for (const linked of this.deps.config.integrations.github.linkedRepos) {
      const access = await this.runCommand(gh, ['repo', 'view', linked.repo, '--json', 'nameWithOwner'])
      if (!access.ok) {
        return check(
          'github',
          'GitHub',
          'error',
          true,
          `Cannot read linked repository ${linked.repo}`,
          'Check the repository name and GitHub token permissions',
        )
      }
    }
    return check(
      'github',
      'GitHub',
      'ok',
      true,
      `Authenticated with read access to ${this.deps.config.integrations.github.linkedRepos.length} linked repositories`,
    )
  }

  private async linearCheck(): Promise<DiagnosticCheck> {
    if (!this.deps.config.integrations.linear.enabled) {
      return check('linear', 'Linear', 'skipped', false, 'Integration is disabled')
    }
    if (!process.env.LINEAR_API_KEY?.trim()) {
      return check(
        'linear',
        'Linear',
        'error',
        true,
        'LINEAR_API_KEY is not configured',
        'Add LINEAR_API_KEY to ~/.portta/.env and restart the service',
      )
    }
    const result = await this.deps.linearProbe?.()
    if (!result) return check('linear', 'Linear', 'warning', true, 'Credential is set but was not verified')
    return result.ok
      ? check('linear', 'Linear', 'ok', true, 'Authenticated and able to query assigned issues')
      : check('linear', 'Linear', 'error', true, result.error, 'Check LINEAR_API_KEY and Linear API access')
  }

  private async dockerChecks(): Promise<DiagnosticCheck[]> {
    const images = [
      ...new Set(
        Object.values(this.deps.config.profiles)
          .filter((profile) => profile.runtime === 'docker')
          .map((profile) => profile.image)
          .filter((image): image is string => Boolean(image)),
      ),
    ]
    if (images.length === 0) return [check('docker', 'Docker', 'skipped', false, 'No Docker profiles configured')]

    const docker = this.resolveCommand('docker')
    if (!docker) {
      return [check('docker', 'Docker', 'error', true, 'Docker daemon is unavailable', 'Start Docker and retry')]
    }
    const daemon = await this.runCommand(docker, ['info', '--format', '{{.ServerVersion}}'])
    if (!daemon.ok) {
      return [check('docker', 'Docker', 'error', true, 'Docker daemon is unavailable', 'Start Docker and retry')]
    }

    const dockerVersion = daemon.output.split('\n')[0] ?? daemon.output
    const checks: DiagnosticCheck[] = [check('docker', 'Docker', 'ok', true, `Docker ${dockerVersion} is ready`)]
    for (const image of images) {
      const inspect = await this.runCommand(docker, ['image', 'inspect', image, '--format', '{{.Id}}'])
      if (!inspect.ok) {
        checks.push(
          check(
            `docker-image:${image}`,
            `Docker image ${image}`,
            'error',
            true,
            'Image is unavailable locally',
            `Pull or build ${image}`,
          ),
        )
        continue
      }
      const agent = this.deps.config.workspace.defaultAgent
      const executable = await this.runCommand(docker, [
        'run',
        '--rm',
        '--entrypoint',
        '/bin/sh',
        image,
        '-lc',
        `export PATH="$PATH:${DOCKER_AGENT_PATH}"; command -v ${agent}`,
      ])
      checks.push(
        executable.ok
          ? check(`docker-image:${image}`, `Docker image ${image}`, 'ok', true, `${agent} is available`)
          : check(
              `docker-image:${image}`,
              `Docker image ${image}`,
              'error',
              true,
              `${agent} is unavailable in the image`,
              `Install ${agent} in ${image}`,
            ),
      )
    }
    return checks
  }
}
