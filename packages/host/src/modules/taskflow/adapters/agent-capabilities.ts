import { NodeProcessRunner, type ProcessRunner } from './process-runner.ts'

const CAPABILITY_TIMEOUT_MS = 15_000
const CODEX_AUTO_REVIEW_FLAG = '--approve-for-me'
const DOCKER_CODEX_PATH = '/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin'

export type AgentRuntimeLocation = { runtime: 'host' } | { runtime: 'docker'; image: string }

export type AgentCapabilityResult = { ok: true } | { ok: false; reason: string }

export interface AgentCapabilitiesGateway {
  checkCodexAutoReview(location: AgentRuntimeLocation): Promise<AgentCapabilityResult>
}

export function codexHelpSupportsAutoReview(help: string): boolean {
  return help.includes(CODEX_AUTO_REVIEW_FLAG)
}

export class NodeAgentCapabilitiesGateway implements AgentCapabilitiesGateway {
  private readonly processRunner: ProcessRunner
  constructor(processRunner: ProcessRunner = new NodeProcessRunner()) {
    this.processRunner = processRunner
  }

  async checkCodexAutoReview(location: AgentRuntimeLocation): Promise<AgentCapabilityResult> {
    const spec =
      location.runtime === 'host'
        ? { command: 'codex', args: ['--help'], timeoutMs: CAPABILITY_TIMEOUT_MS }
        : {
            command: 'docker',
            args: [
              'run',
              '--rm',
              '--entrypoint',
              '/bin/sh',
              location.image,
              '-lc',
              `export PATH="$PATH:${DOCKER_CODEX_PATH}"; codex --help`,
            ],
            timeoutMs: CAPABILITY_TIMEOUT_MS,
          }
    const process = this.processRunner.start(spec)
    const [exit, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    const output = `${stdout}\n${stderr}`
    if (exit.code === 0 && codexHelpSupportsAutoReview(output)) return { ok: true }

    if (exit.timedOut) return { ok: false, reason: 'capability check timed out' }
    if (exit.code === null) return { ok: false, reason: 'Codex executable could not be started' }
    if (exit.code !== 0) return { ok: false, reason: stderr.trim() || `Codex exited with code ${exit.code}` }
    return { ok: false, reason: `${CODEX_AUTO_REVIEW_FLAG} is unavailable` }
  }
}
