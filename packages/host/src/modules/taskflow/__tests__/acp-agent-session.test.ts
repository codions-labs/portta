import * as acp from '@agentclientprotocol/sdk'
import type { EnvironmentCommandHandle } from 'portta-core/taskflow'
import { describe, expect, it, vi } from 'vitest'
import { runAcpAgentSession } from '../services/acp-agent-session.ts'
import { connectedAcpProcess } from './acp-test-transport.ts'

describe('runAcpAgentSession', () => {
  it('negotiates, creates a session in the requested cwd, and streams a result', async () => {
    const connected = connectedAcpProcess()
    let cwd = ''
    const agent = acp
      .agent({ name: 'fake-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false, mcpCapabilities: { http: false, sse: false } },
      }))
      .onRequest(acp.methods.agent.session.new, (context) => {
        cwd = context.params.cwd
        return { sessionId: 'session_fake' }
      })
      .onRequest(acp.methods.agent.session.prompt, async (context) => {
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
        })
        return { stopReason: 'end_turn' }
      })
      .onNotification(acp.methods.agent.session.cancel, () => {})
    const serving = agent.connect(connected.agentStream)
    const ready: string[] = []
    const result = await runAcpAgentSession({
      process: connected.process,
      cwd: '/workspace/project',
      prompt: 'Inspect',
      permissionMode: 'deny',
      mcpServers: [],
      spawnTerminal: () => {
        throw new Error('terminal was not expected')
      },
      onReady: (sessionId) => ready.push(sessionId),
      onEvent: () => {},
      requestPermission: () => Promise.resolve(null),
    })
    expect(cwd).toBe('/workspace/project')
    expect(ready).toEqual(['session_fake'])
    expect(result).toEqual({ sessionId: 'session_fake', stopReason: 'end_turn', text: 'done' })
    await serving.close()
  })

  it('waits for an interactive permission decision before continuing', async () => {
    const connected = connectedAcpProcess()
    let answer = null as ((optionId: string | null) => void) | null
    const agent = acp
      .agent({ name: 'permission-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session_permission' }))
      .onRequest(acp.methods.agent.session.prompt, async (context) => {
        const response = await context.client.request(acp.methods.client.session.requestPermission, {
          sessionId: context.params.sessionId,
          toolCall: {
            title: 'Run tests',
            kind: 'execute',
            status: 'pending',
            toolCallId: 'tool-01',
            content: [],
          },
          options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'once' }],
        })
        expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'once' })
        return { stopReason: 'end_turn' }
      })
    const serving = agent.connect(connected.agentStream)
    const result = runAcpAgentSession({
      process: connected.process,
      cwd: '/workspace/project',
      prompt: 'Test',
      permissionMode: 'interactive',
      mcpServers: [],
      spawnTerminal: () => {
        throw new Error('terminal was not expected')
      },
      onReady: () => {},
      onEvent: () => {},
      requestPermission: () =>
        new Promise((resolve): void => {
          answer = resolve
        }),
    })
    await vi.waitFor(() => expect(answer).not.toBeNull())
    answer?.('once')
    await expect(result).resolves.toMatchObject({ sessionId: 'session_permission', stopReason: 'end_turn' })
    await serving.close()
  })

  it('runs terminal commands, drains output, and reports their exit status', async () => {
    const connected = connectedAcpProcess()
    const events: string[] = []
    let invocation: { command: string; args: string[]; cwd: string; env: Record<string, string> } | null = null
    let terminalResult: { output: string; exitCode: number | null | undefined } | null = null
    const agent = acp
      .agent({ name: 'terminal-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'session_terminal' }))
      .onRequest(acp.methods.agent.session.prompt, async (context) => {
        const created = await context.client.request(acp.methods.client.terminal.create, {
          sessionId: context.params.sessionId,
          command: 'long-command',
          args: ['--result'],
          cwd: '/workspace/project',
          env: [{ name: 'MODE', value: 'test' }],
        })
        const exit = await context.client.request(acp.methods.client.terminal.waitForExit, {
          sessionId: context.params.sessionId,
          terminalId: created.terminalId,
        })
        const output = await context.client.request(acp.methods.client.terminal.output, {
          sessionId: context.params.sessionId,
          terminalId: created.terminalId,
        })
        terminalResult = { output: output.output, exitCode: exit.exitCode }
        await context.client.request(acp.methods.client.terminal.release, {
          sessionId: context.params.sessionId,
          terminalId: created.terminalId,
        })
        return { stopReason: 'end_turn' }
      })
    const serving = agent.connect(connected.agentStream)
    const result = await runAcpAgentSession({
      process: connected.process,
      cwd: '/workspace/project',
      prompt: 'Run it',
      permissionMode: 'deny',
      mcpServers: [],
      spawnTerminal: (command, args, cwd, env): EnvironmentCommandHandle => {
        invocation = { command, args, cwd, env }
        return {
          pid: 84,
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('result ready'))
              controller.close()
            },
          }),
          stderr: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
          exited: Promise.resolve({ code: 7, signal: null, timedOut: false }),
          write: (): Promise<void> => Promise.resolve(),
          closeStdin: (): void => {},
          interrupt: (): Promise<void> => Promise.resolve(),
          kill: (): Promise<void> => Promise.resolve(),
        }
      },
      onReady: () => {},
      onEvent: (type) => events.push(type),
      requestPermission: () => Promise.resolve(null),
    })

    expect(result.stopReason).toBe('end_turn')
    expect(invocation).toEqual({
      command: 'long-command',
      args: ['--result'],
      cwd: '/workspace/project',
      env: { MODE: 'test' },
    })
    expect(terminalResult).toEqual({ output: 'result ready', exitCode: 7 })
    expect(events).toEqual(
      expect.arrayContaining(['terminal.started', 'terminal.output', 'terminal.exited', 'terminal.released']),
    )
    connected.exit()
    await serving.close()
  })

  it('resumes an existing logical session only after capability negotiation', async () => {
    const connected = connectedAcpProcess()
    let resumed: { sessionId: string; cwd: string } | null = null
    const agent = acp
      .agent({ name: 'resume-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } },
      }))
      .onRequest(acp.methods.agent.session.resume, (context) => {
        resumed = { sessionId: context.params.sessionId, cwd: context.params.cwd }
        return {}
      })
      .onRequest(acp.methods.agent.session.prompt, () => ({ stopReason: 'end_turn' }))
    const serving = agent.connect(connected.agentStream)
    await runAcpAgentSession({
      process: connected.process,
      cwd: '/workspace/resumed',
      prompt: 'Continue',
      sessionId: 'session_existing',
      permissionMode: 'deny',
      mcpServers: [],
      spawnTerminal: () => {
        throw new Error('terminal was not expected')
      },
      onReady: () => {},
      onEvent: () => {},
      requestPermission: () => Promise.resolve(null),
    })
    expect(resumed).toEqual({ sessionId: 'session_existing', cwd: '/workspace/resumed' })
    connected.exit()
    await serving.close()
  })
})
