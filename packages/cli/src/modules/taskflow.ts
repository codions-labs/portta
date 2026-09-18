// Taskflow's half in the CLI: the `portta flow` command tree, its tools in
// `portta mcp`, and its checks in `portta doctor`.
//
// The tree talks to the host daemon over HTTP and, for the commands that always
// did, runs the Taskflow runtime in-process. Both read the daemon's address and
// state directory from the environment, so the installation's `.env` is folded
// in before any flow command runs.

import { taskflowModule } from 'portta-core/modules'
import { ENV_NAMES } from 'portta-core/taskflow/config'
import { registerTaskflowTools } from 'portta-mcp'
import { flowStateDir } from '../commands/flow/daemon.ts'
import { createFlowCommand } from '../commands/flow/index.ts'
import type { CliModule } from './index.js'
import { taskflowDoctorChecks } from './taskflow-doctor.js'

/** The daemon settings a flow command inherits from the installation, unless exported. */
const DAEMON_SETTINGS = [
  ENV_NAMES.host,
  ENV_NAMES.hostPort,
  ENV_NAMES.hostStateDir,
  ENV_NAMES.projectAllowlist,
] as const

export const taskflowCliModule: CliModule = {
  manifest: taskflowModule,
  register: (program, context) => {
    const flow = createFlowCommand({ name: 'flow' })
    flow.hook('preAction', () => {
      for (const name of DAEMON_SETTINGS) {
        const value = context.env[name]
        if (process.env[name] === undefined && value !== undefined) process.env[name] = value
      }
      // One state directory for the daemon and every in-process runtime.
      process.env[ENV_NAMES.hostStateDir] = flowStateDir()
    })
    program.addCommand(flow)
  },
  mcp: registerTaskflowTools,
  doctor: (context) => taskflowDoctorChecks(context),
}
