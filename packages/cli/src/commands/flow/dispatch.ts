import { taskflowAssets } from 'portta-host/taskflow/assets'
import { refreshHostShellPath } from 'portta-host/taskflow/lib/user-shell-env'
import type { FlowAction } from './flow-action.ts'
import { resolveServerPort } from './server-port.ts'
import { CommandUsageError } from './shared.ts'

/** Turn a validation failure into the same usage error commander reports. */
function validate<T>(action: FlowAction, build: () => T): T {
  try {
    return build()
  } catch (error) {
    if (!(error instanceof CommandUsageError)) throw error
    return action.command.error(`error: ${error.message}`)
  }
}

interface Prepared {
  port: number
  projectDir: string
  projectEnvKeys: Set<string>
}

/** What every project-facing command needs once its input is known to be
 *  valid: the user's shell PATH, the launch project's env, and the port. */
async function prepare(action: FlowAction): Promise<Prepared> {
  await refreshHostShellPath()
  const { loadProjectEnv } = await import('./project-env.ts')
  return {
    projectEnvKeys: await loadProjectEnv(),
    port: resolveServerPort(action.options.port ?? action.globals.port),
    projectDir: process.cwd(),
  }
}

/**
 * Run one parsed invocation. Each handler is imported only when its command
 * runs, so the tree itself stays cheap to build.
 */
export async function runFlowAction(action: FlowAction): Promise<number> {
  const [command, subcommand] = action.path

  switch (command) {
    case '__complete': {
      const { handleCompletions } = await import('./completions.ts')
      return handleCompletions(String(action.args[0]))
    }
    case 'completion': {
      const { runCompletionCommand } = await import('./completions.ts')
      return runCompletionCommand(action.args[0] as string | undefined, action.root)
    }
    case 'init': {
      const { initOptionsFromCli, runInit } = await import('./init.ts')
      const options = validate(action, () => initOptionsFromCli(action.options))
      await refreshHostShellPath()
      await runInit(options)
      return Number(process.exitCode ?? 0)
    }
    case 'oneshot': {
      const { oneshotFromCli, runOneshot } = await import('./oneshot.ts')
      const parsed = validate(action, () => oneshotFromCli(action.args[0] as string | undefined, action.options))
      const { port } = await prepare(action)
      return runOneshot(parsed, port)
    }
    case 'doctor': {
      const { runDoctorCommand } = await import('./doctor.ts')
      const { port, projectDir } = await prepare(action)
      return runDoctorCommand({ json: Boolean(action.options.json) }, port, projectDir)
    }
    case 'linear': {
      const { linearPostFromCli, runLinearCommand } = await import('./linear-commands.ts')
      const post = validate(action, () =>
        linearPostFromCli(String(action.args[0]), String(action.args[1]), action.options),
      )
      const { port } = await prepare(action)
      return runLinearCommand(post, port)
    }
    case 'project': {
      const { projectFromCli, runProjectCommand } = await import('./project-commands.ts')
      const { port } = await prepare(action)
      return runProjectCommand(projectFromCli(action), port)
    }
    case 'environment': {
      const { environmentFromCli, runEnvironmentCommand } = await import('./worktree-commands.ts')
      const request = validate(action, () => environmentFromCli(action))
      const { port, projectDir } = await prepare(action)
      return runEnvironmentCommand(request, port, projectDir)
    }
    case 'workflows':
      if (subcommand !== 'list') {
        // The standalone workflow engine, which parses its own arguments.
        await prepare(action)
        ;(globalThis as { __PORTTA_FLOW_EMBEDDED_WORKFLOW_CLI__?: boolean }).__PORTTA_FLOW_EMBEDDED_WORKFLOW_CLI__ =
          true
        const assets = taskflowAssets()
        const { main: runWorkflowCli } = await import('portta-host/taskflow/workflows/cli')
        await runWorkflowCli([subcommand ?? '', ...((action.args[0] as string[] | undefined) ?? [])], {
          registryRoots: { builtinDir: assets.workflowBuiltinsDir },
          skillPath: assets.workflowSkill,
        })
        return Number(process.exitCode ?? 0)
      }
      return runRuns(action)
    case 'run':
    case 'runs':
      return runRuns(action)
  }

  const { runWorktreeCommand, worktreeRequestFromCli } = await import('./worktree-commands.ts')
  const request = validate(action, () => worktreeRequestFromCli(action))
  const { port, projectDir } = await prepare(action)
  return runWorktreeCommand({ request, projectDir, port })
}

async function runRuns(action: FlowAction): Promise<number> {
  const { runCommandFromCli, runRunCommand } = await import('./run-commands.ts')
  const parsed = validate(action, () => runCommandFromCli(action))
  const { port } = await prepare(action)
  return runRunCommand(parsed, port)
}
