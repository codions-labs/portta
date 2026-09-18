import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentSupervisorStore } from '../adapters/agent-supervisor-store.ts'
import type { AgentLaunchSpec } from '../services/agent-runtime-types.ts'
import { AgentSupervisor } from '../services/agent-supervisor.ts'
import { connectedAcpProcess } from './acp-test-transport.ts'

const roots: string[] = []

afterEach((): void => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function launchSpec(operationId: string): AgentLaunchSpec {
  return {
    operationId,
    transport: 'acp',
    provider: 'opencode',
    command: 'opencode',
    args: ['acp'],
    cwd: '/workspace',
    prompt: 'Run the long task',
    permissionMode: 'deny',
    mcpServers: [],
    execution: { provider: 'host', hostPath: '/workspace', containerPath: null, containerRef: null },
  }
}

describe('AgentSupervisor', () => {
  it('keeps a long operation observable and persists its result', async () => {
    const connected = connectedAcpProcess()
    let finish = null as (() => void) | null
    const agent = acp
      .agent({ name: 'long-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session_long' }))
      .onRequest(acp.methods.agent.session.prompt, async (context) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'finished' } },
        })
        return { stopReason: 'end_turn' }
      })
    const serving = agent.connect(connected.agentStream)
    const root = mkdtempSync(join(tmpdir(), 'taskflow-supervisor-long-'))
    roots.push(root)
    const store = createAgentSupervisorStore(join(root, 'supervisor.sqlite'))
    const supervisor = new AgentSupervisor({
      store,
      launch: () => ({
        process: connected.process,
        spawnTerminal: () => {
          throw new Error('terminal was not expected')
        },
      }),
    })

    await supervisor.start(launchSpec('run_long:call_1'))
    await vi.waitFor(async () => expect((await supervisor.inspect('run_long:call_1')).status).toBe('running'))
    expect(finish).not.toBeNull()
    finish?.()
    await vi.waitFor(async () => expect((await supervisor.inspect('run_long:call_1')).status).toBe('completed'))
    expect(await supervisor.inspect('run_long:call_1')).toMatchObject({
      sessionId: 'session_long',
      result: { text: 'finished', stopReason: 'end_turn' },
      exitCode: 0,
    })
    expect((await supervisor.events('run_long:call_1')).map((event) => event.type)).toContain('agent.completed')

    connected.exit()
    await serving.close()
    store.close()
  })

  it('sends ACP cancellation and records cancellation as terminal', async () => {
    const connected = connectedAcpProcess()
    let cancelled = false
    let stopPrompt: (() => void) | null = null
    const agent = acp
      .agent({ name: 'cancel-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session_cancel' }))
      .onRequest(
        acp.methods.agent.session.prompt,
        () =>
          new Promise<{ stopReason: 'cancelled' }>((resolve) => {
            stopPrompt = () => resolve({ stopReason: 'cancelled' })
          }),
      )
      .onNotification(acp.methods.agent.session.cancel, () => {
        cancelled = true
        stopPrompt?.()
        connected.exit({ code: 0, signal: null, timedOut: false })
      })
    const serving = agent.connect(connected.agentStream)
    const root = mkdtempSync(join(tmpdir(), 'taskflow-supervisor-cancel-'))
    roots.push(root)
    const store = createAgentSupervisorStore(join(root, 'supervisor.sqlite'))
    const supervisor = new AgentSupervisor({
      store,
      launch: () => ({
        process: connected.process,
        spawnTerminal: () => {
          throw new Error('terminal was not expected')
        },
      }),
    })

    await supervisor.start(launchSpec('run_cancel:call_1'))
    await vi.waitFor(async () => expect((await supervisor.inspect('run_cancel:call_1')).status).toBe('running'))
    await expect(supervisor.cancel('run_cancel:call_1')).resolves.toMatchObject({ status: 'cancelled' })
    expect(cancelled).toBe(true)

    await serving.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.close()
  })

  it('marks an active operation for recovery after a supervisor restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'taskflow-supervisor-recovery-'))
    roots.push(root)
    const store = createAgentSupervisorStore(join(root, 'supervisor.sqlite'))
    store.create(launchSpec('run_recovery:call_1'))
    store.update('run_recovery:call_1', { status: 'running', pid: 123 })
    const supervisor = new AgentSupervisor({
      store,
      launch: () => {
        throw new Error('launch was not expected')
      },
    })

    expect(supervisor.recoverInterrupted()).toEqual([
      expect.objectContaining({ id: 'run_recovery:call_1', status: 'recovery_required', pid: 123 }),
    ])
    store.close()
  })
})
