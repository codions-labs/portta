import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentSupervisorStore } from '../adapters/agent-supervisor-store.ts'

const roots: string[] = []

afterEach((): void => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AgentSupervisorStore', () => {
  it('persists operations and replays stable operation keys', () => {
    const root = mkdtempSync(join(tmpdir(), 'taskflow-supervisor-'))
    roots.push(root)
    const path = join(root, 'runtime.sqlite')
    const first = createAgentSupervisorStore(path)
    const created = first.create({
      operationId: 'run_01:direct:root:1',
      transport: 'acp',
      provider: 'opencode',
      command: 'opencode',
      args: ['acp'],
      cwd: '/workspace',
      prompt: 'Inspect',
      permissionMode: 'deny',
      mcpServers: [],
      execution: { provider: 'host', hostPath: '/workspace', containerPath: null, containerRef: null },
    })
    expect(created.replayed).toBe(false)
    first.update(created.operation.id, { status: 'running', pid: 123, sessionId: 'session_01' })
    first.appendEvent(created.operation.id, 'agent.message', { text: 'hello' })
    first.close()

    const reopened = createAgentSupervisorStore(path)
    const replayed = reopened.create({
      operationId: 'run_01:direct:root:1',
      transport: 'acp',
      provider: 'opencode',
      command: 'ignored',
      args: [],
      cwd: '/different',
      prompt: 'ignored',
      permissionMode: 'deny',
      mcpServers: [],
      execution: { provider: 'host', hostPath: '/different', containerPath: null, containerRef: null },
    })
    expect(replayed.replayed).toBe(true)
    expect(replayed.operation).toMatchObject({ pid: 123, sessionId: 'session_01', status: 'running' })
    expect(reopened.listEvents(replayed.operation.id, 0)).toHaveLength(1)
    reopened.close()
  })
})
