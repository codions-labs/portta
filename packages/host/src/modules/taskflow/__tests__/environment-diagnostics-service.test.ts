import type { ProjectConfig } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import type { ProcessRunner, ProcessSpec, RunningProcess } from '../adapters/process-runner.ts'
import { EnvironmentDiagnosticsService } from '../services/environment-diagnostics-service.ts'

function stream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller): void {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

class FakeProcessRunner implements ProcessRunner {
  private readonly results: Record<string, { code: number; stdout?: string; stderr?: string }>
  constructor(results: Record<string, { code: number; stdout?: string; stderr?: string }>) {
    this.results = results
  }

  start(spec: ProcessSpec): RunningProcess {
    const result = this.results[[spec.command, ...spec.args].join(' ')] ?? { code: 1 }
    return {
      pid: 1,
      stdout: stream(result.stdout ?? ''),
      stderr: stream(result.stderr ?? ''),
      exited: Promise.resolve({ code: result.code, signal: null, timedOut: false }),
      writeStdin: async () => {},
      closeStdin: () => {},
      kill: () => true,
    }
  }
}

const CONFIG: ProjectConfig = {
  name: 'Test',
  multiplexer: 'tmux',
  workspace: {
    mainBranch: 'main',
    worktreeRoot: '__worktrees',
    worktrees: { root: '__worktrees' },
    defaultAgent: 'codex',
    autoPull: { enabled: false, intervalSeconds: 300 },
  },
  profiles: { default: { runtime: 'host', envPassthrough: [], panes: [{ id: 'agent', kind: 'agent' }] } },
  exposure: { local: { provider: 'loopback', autoExpose: 'all' } },
  agents: {},
  services: [],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: false, autoCreateWorktrees: false, createTicketOption: false },
  },
  providers: {},
  lifecycleHooks: {},
  autoName: null,
  oneshot: { systemPrompt: '' },
}

describe('EnvironmentDiagnosticsService', () => {
  it('reports a ready project when required local capabilities pass', async () => {
    const service = new EnvironmentDiagnosticsService({
      config: CONFIG,
      resolveTool: (command: string): string | null => command,
      processRunner: new FakeProcessRunner({
        'git --version': { code: 0, stdout: 'git version 2.50' },
        'tmux -V': { code: 0, stdout: 'tmux 3.5' },
        'codex --version': { code: 0, stdout: 'codex-cli 0.153.4' },
        'codex --help': { code: 0, stdout: 'Usage: codex\n  --approve-for-me' },
      }),
      now: () => new Date('2026-09-10T12:00:00.000Z'),
    })

    const result = await service.run()

    expect(result.ready).toBe(true)
    expect(result.checkedAt).toBe('2026-09-10T12:00:00.000Z')
    expect(result.checks.find((item) => item.id === 'codex-auto-review')?.status).toBe('ok')
    expect(result.checks.find((item) => item.id === 'github')?.status).toBe('skipped')
  })

  it('marks configured integrations as required errors', async () => {
    const previousKey = process.env.LINEAR_API_KEY
    delete process.env.LINEAR_API_KEY
    try {
      const service = new EnvironmentDiagnosticsService({
        config: {
          ...CONFIG,
          integrations: {
            ...CONFIG.integrations,
            linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
          },
        },
        resolveTool: (command: string): string | null => command,
        processRunner: new FakeProcessRunner({
          'git --version': { code: 0, stdout: 'git version 2.50' },
          'tmux -V': { code: 0, stdout: 'tmux 3.5' },
          'codex --version': { code: 0, stdout: 'codex-cli 0.153.4' },
          'codex --help': { code: 0, stdout: 'Usage: codex\n  --approve-for-me' },
        }),
      })

      const result = await service.run()

      expect(result.ready).toBe(false)
      expect(result.checks.find((item) => item.id === 'linear')).toMatchObject({ status: 'error', required: true })
    } finally {
      if (previousKey === undefined) delete process.env.LINEAR_API_KEY
      else process.env.LINEAR_API_KEY = previousKey
    }
  })

  it('reports a required agent as unavailable when the binary cannot be resolved', async () => {
    const service = new EnvironmentDiagnosticsService({
      config: CONFIG,
      resolveTool: (command: string): string | null => (command === 'codex' ? null : command),
      processRunner: new FakeProcessRunner({
        'git --version': { code: 0, stdout: 'git version 2.50' },
        'tmux -V': { code: 0, stdout: 'tmux 3.5' },
      }),
    })

    const result = await service.run()
    expect(result.ready).toBe(false)
    expect(result.checks.find((item) => item.id === 'agent')).toMatchObject({
      status: 'error',
      summary: 'codex is unavailable',
    })
  })

  it('distinguishes a resolved agent whose version probe failed', async () => {
    const service = new EnvironmentDiagnosticsService({
      config: CONFIG,
      resolveTool: (command: string): string | null => command,
      processRunner: new FakeProcessRunner({
        'git --version': { code: 0, stdout: 'git version 2.50' },
        'tmux -V': { code: 0, stdout: 'tmux 3.5' },
        'codex --version': { code: 1, stderr: 'not authenticated' },
        'codex --help': { code: 0, stdout: 'Usage: codex\n  --approve-for-me' },
      }),
    })

    const result = await service.run()
    expect(result.checks.find((item) => item.id === 'agent')).toMatchObject({
      status: 'error',
      summary: 'codex was found but `codex --version` failed',
    })
  })
})
