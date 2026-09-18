import { AgentsUiConversationEventSchema, apiPaths } from 'portta-contracts/taskflow'
import type {
  AgentsUiConversationEvent,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageRequest,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
} from '../types.ts'
import type { TaskflowClient } from './client.ts'

export interface ConversationStreamCallbacks {
  onEvent: (event: AgentsUiConversationEvent) => void
  onError: (reason: 'malformed' | 'connection') => void
  onClose?: () => void
}

export function conversationApi({ contract, socketUrl }: TaskflowClient) {
  return {
    attachWorktreeConversation: (branch: string): Promise<AgentsUiWorktreeConversationResponse> =>
      contract.attachAgentsWorktreeConversation({ params: { name: branch } }),
    fetchWorktreeConversationHistory: (branch: string): Promise<AgentsUiWorktreeConversationResponse> =>
      contract.fetchAgentsWorktreeConversationHistory({ params: { name: branch } }),
    sendWorktreeConversationMessage: (
      branch: string,
      body: AgentsUiSendMessageRequest,
    ): Promise<AgentsUiSendMessageResponse> =>
      contract.sendAgentsWorktreeConversationMessage({ params: { name: branch }, body }),
    interruptWorktreeConversation: (branch: string): Promise<AgentsUiInterruptResponse> =>
      contract.interruptAgentsWorktreeConversation({ params: { name: branch } }),

    /** The chat's live stream, on the agent socket the panel bridges to the daemon. */
    connectWorktreeConversationStream(branch: string, callbacks: ConversationStreamCallbacks): () => void {
      const path = apiPaths.streamAgentsWorktreeConversation.replace(':name', encodeURIComponent(branch))
      const socket = new WebSocket(socketUrl(path))
      let closedByClient = false

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        try {
          callbacks.onEvent(AgentsUiConversationEventSchema.parse(JSON.parse(event.data)))
        } catch {
          callbacks.onError('malformed')
        }
      })
      socket.addEventListener('error', () => callbacks.onError('connection'))
      socket.addEventListener('close', () => {
        if (!closedByClient) callbacks.onClose?.()
      })

      return () => {
        closedByClient = true
        socket.close()
      }
    },
  }
}
