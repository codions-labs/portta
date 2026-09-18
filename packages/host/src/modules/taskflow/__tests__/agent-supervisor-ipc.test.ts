import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentSupervisorStore } from '../adapters/agent-supervisor-store.ts'
import { AgentSupervisor } from '../services/agent-supervisor.ts'
import { AgentSupervisorClient } from '../services/agent-supervisor-client.ts'
import { startAgentSupervisorServer } from '../services/agent-supervisor-server.ts'

const roots: string[] = []

afterEach((): void => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('agent supervisor IPC', () => {
  it('exposes daemon status over a permission-restricted Unix socket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taskflow-supervisor-ipc-'))
    roots.push(root)
    const socketPath = join(root, 'supervisor.sock')
    const store = createAgentSupervisorStore(join(root, 'supervisor.sqlite'))
    const supervisor = new AgentSupervisor({
      store,
      launch: () => {
        throw new Error('launch was not expected')
      },
    })
    const server = await startAgentSupervisorServer(socketPath, supervisor)
    const client = new AgentSupervisorClient({ socketPath })
    expect(statSync(socketPath).mode & 0o777).toBe(0o600)
    expect(await client.hasActiveOperations()).toBe(false)
    const malformed = await new Promise<string>((resolve, reject): void => {
      const socket = createConnection(socketPath)
      let output = ''
      socket.setEncoding('utf8')
      socket.on('connect', () => socket.write('{\n'))
      socket.on('data', (chunk: string) => {
        output += chunk
      })
      socket.on('error', reject)
      socket.on('close', () => resolve(output))
    })
    expect(JSON.parse(malformed)).toMatchObject({ id: 'invalid-request', version: 1 })
    expect(await client.hasActiveOperations()).toBe(false)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  })
})
