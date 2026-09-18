import type { EnvironmentCommandHandle } from 'portta-core/taskflow'
import type { AgentLaunchSpec, SupervisorExecution } from '../services/agent-runtime-types.ts'
import { NodeProcessRunner, type ProcessRunner, type RunningProcess } from './process-runner.ts'

function commandFor(
  execution: SupervisorExecution,
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): { command: string; args: string[]; cwd: string; env?: Record<string, string> } {
  if (execution.provider === 'host') return { command, args, cwd, env }
  if (!execution.containerRef) throw new Error(`${execution.provider} execution has no container reference`)
  return {
    command: 'docker',
    args: [
      'exec',
      '-i',
      '-w',
      cwd,
      ...Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
      execution.containerRef,
      command,
      ...args,
    ],
    cwd: execution.hostPath,
  }
}

function commandHandle(process: RunningProcess): EnvironmentCommandHandle {
  return {
    pid: process.pid,
    stdout: process.stdout,
    stderr: process.stderr,
    exited: process.exited,
    write: (input) => process.writeStdin(input),
    closeStdin: () => process.closeStdin(),
    interrupt: async (): Promise<void> => {
      process.kill('SIGINT')
    },
    kill: async (): Promise<void> => {
      process.kill('SIGKILL')
    },
  }
}

export function launchSupervisorCommand(
  execution: SupervisorExecution,
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  runner: ProcessRunner = new NodeProcessRunner(),
): EnvironmentCommandHandle {
  const launch = commandFor(execution, command, args, cwd, env)
  return commandHandle(
    runner.start({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: launch.env,
      keepStdinOpen: true,
    }),
  )
}

export function launchSupervisorAgent(spec: AgentLaunchSpec, runner?: ProcessRunner): EnvironmentCommandHandle {
  return launchSupervisorCommand(spec.execution, spec.command, spec.args, spec.cwd, spec.env ?? {}, runner)
}
