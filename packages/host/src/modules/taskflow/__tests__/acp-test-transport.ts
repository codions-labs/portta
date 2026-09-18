import * as acp from '@agentclientprotocol/sdk'
import type { AcpAgentProcess } from '../services/acp-agent-session.ts'

export interface ConnectedAcpProcess {
  process: AcpAgentProcess
  agentStream: acp.Stream
  exit(result?: { code: number | null; signal: string | null; timedOut: boolean }): void
}

export function connectedAcpProcess(): ConnectedAcpProcess {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const writer = clientToAgent.writable.getWriter()
  let exit: ConnectedAcpProcess['exit'] = () => {}
  const exited = new Promise<{ code: number | null; signal: string | null; timedOut: boolean }>((resolve) => {
    exit = (result = { code: 0, signal: null, timedOut: false }): void => resolve(result)
  })
  return {
    process: {
      pid: 42,
      stdout: agentToClient.readable,
      stderr: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
      exited,
      write: (input) => writer.write(typeof input === 'string' ? new TextEncoder().encode(input) : input),
      closeStdin: (): void => {},
      interrupt: async (): Promise<void> => exit({ code: null, signal: 'SIGINT', timedOut: false }),
      kill: async (): Promise<void> => exit({ code: null, signal: 'SIGKILL', timedOut: false }),
    },
    agentStream: acp.ndJsonStream(agentToClient.writable, clientToAgent.readable),
    exit,
  }
}
