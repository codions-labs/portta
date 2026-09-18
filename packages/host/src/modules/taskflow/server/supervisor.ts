#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globalPaths } from 'portta-core/taskflow/paths'
import { createAgentSupervisorStore } from '../adapters/agent-supervisor-store.ts'
import { launchSupervisorAgent, launchSupervisorCommand } from '../adapters/supervisor-execution.ts'
import { AgentSupervisor } from '../services/agent-supervisor.ts'
import { startAgentSupervisorServer } from '../services/agent-supervisor-server.ts'

const root = globalPaths().root
const socketPath = process.env.PORTTA_FLOW_SUPERVISOR_SOCKET ?? join(root, 'runtime', 'supervisor.sock')
const storePath = process.env.PORTTA_FLOW_SUPERVISOR_STORE ?? join(root, 'runtime', 'supervisor.sqlite')
mkdirSync(dirname(socketPath), { recursive: true })
const store = createAgentSupervisorStore(storePath)
const supervisor = new AgentSupervisor({
  store,
  launch: (spec) => ({
    process: launchSupervisorAgent(spec),
    spawnTerminal: (command, args, cwd, env) => launchSupervisorCommand(spec.execution, command, args, cwd, env),
  }),
})

const server = await startAgentSupervisorServer(socketPath, supervisor)

async function stop(): Promise<void> {
  if (await supervisor.hasActiveOperations()) return
  server.close((): void => {
    store.close()
    process.exit(0)
  })
}

process.on('SIGINT', (): void => {
  void stop()
})
process.on('SIGTERM', (): void => {
  void stop()
})
