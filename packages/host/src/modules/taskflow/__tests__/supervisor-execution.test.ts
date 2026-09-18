import { describe, expect, it } from 'vitest'
import type { ProcessRunner, ProcessSpec, RunningProcess } from '../adapters/process-runner.ts'
import { launchSupervisorCommand } from '../adapters/supervisor-execution.ts'

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start: (controller) => controller.close() })
}

describe('supervisor execution routing', () => {
  it.each(['docker', 'dockerfile', 'compose', 'devcontainer'] as const)(
    'executes %s agents and terminal commands in the selected container cwd',
    (provider) => {
      let captured: ProcessSpec | null = null
      const runner: ProcessRunner = {
        start(spec): RunningProcess {
          captured = spec
          return {
            pid: 12,
            stdout: emptyStream(),
            stderr: emptyStream(),
            exited: Promise.resolve({ code: 0, signal: null, timedOut: false }),
            writeStdin: (): Promise<void> => Promise.resolve(),
            closeStdin: (): void => {},
            kill: (): boolean => true,
          }
        },
      }
      launchSupervisorCommand(
        {
          provider,
          hostPath: '/host/project',
          containerPath: '/workspace',
          containerRef: 'container-01',
        },
        'opencode',
        ['acp'],
        '/workspace/worktree',
        { TOKEN: 'secret' },
        runner,
      )
      expect(captured).toMatchObject({
        command: 'docker',
        cwd: '/host/project',
        args: ['exec', '-i', '-w', '/workspace/worktree', '-e', 'TOKEN=secret', 'container-01', 'opencode', 'acp'],
      })
    },
  )

  it('executes host commands directly in the selected worktree', () => {
    let captured: ProcessSpec | null = null
    const runner: ProcessRunner = {
      start(spec): RunningProcess {
        captured = spec
        return {
          pid: 12,
          stdout: emptyStream(),
          stderr: emptyStream(),
          exited: Promise.resolve({ code: 0, signal: null, timedOut: false }),
          writeStdin: (): Promise<void> => Promise.resolve(),
          closeStdin: (): void => {},
          kill: (): boolean => true,
        }
      },
    }
    launchSupervisorCommand(
      { provider: 'host', hostPath: '/host/worktree', containerPath: null, containerRef: null },
      'codex-acp',
      [],
      '/host/worktree',
      { TOKEN: 'secret' },
      runner,
    )
    expect(captured).toMatchObject({
      command: 'codex-acp',
      args: [],
      cwd: '/host/worktree',
      env: { TOKEN: 'secret' },
    })
  })
})
