import type {
  AgentsUiConversationEvent,
  AgentsUiConversationMessage,
  AgentsUiWorktreeConversationResponse,
} from 'portta-contracts/taskflow'
import type { WebSocket } from 'ws'
import type { CodexAppServerNotification } from '../../adapters/codex-app-server.ts'
import { log } from '../../lib/log.ts'
import { isRecord } from '../../lib/type-guards.ts'
import {
  AgentsConversationStreamSession,
  readAgentsNotificationThreadId,
} from '../../services/agents-ui-stream-service.ts'
import type { ProjectApp } from '../project-app.ts'
import type { WsRoute } from './upgrade.ts'

function sendAgentsWs(ws: WebSocket, msg: AgentsUiConversationEvent): void {
  if (ws.readyState <= 1) {
    ws.send(JSON.stringify(msg))
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && typeof body.error === 'string' && body.error.length > 0) {
        return body.error
      }
    } catch {
      // Ignore parse failures and fall through to raw text.
    }
  }

  const text = await response.text()
  return text.length > 0 ? text : `HTTP ${response.status}`
}

function nextConversationMessageOrder(messages: AgentsUiConversationMessage[]): number {
  return messages.reduce((order, message) => Math.max(order, message.order + 1), 0)
}

async function loadAgentsConversationInitialState(
  project: ProjectApp,
  branch: string,
): Promise<{ ok: true; data: AgentsUiWorktreeConversationResponse } | { ok: false; message: string }> {
  const resolved = await project.resolveAgentsWorktree(branch)
  if (!resolved.ok) {
    return {
      ok: false,
      message: await readErrorMessage(resolved.response),
    }
  }

  const chatSupport = project.resolveWorktreeAgentChatSupport(resolved.worktree, 'chat')
  if (!chatSupport.ok) {
    return {
      ok: false,
      message: chatSupport.error,
    }
  }

  const result =
    chatSupport.data.provider === 'claude'
      ? await project.claudeConversationService.readWorktreeConversation(resolved.worktree)
      : await project.worktreeConversationService.readWorktreeConversation(resolved.worktree)
  return result.ok
    ? { ok: true, data: project.withClaudeLiveConversation(result.data) }
    : { ok: false, message: result.error }
}

/** The live conversation of a worktree in the agents UI: Codex app-server
 *  notifications or the backend-owned Claude stream, relayed as conversation events. */
export const agentsSocketRoute: WsRoute = {
  path: '/:prefix/ws/agents/worktrees/:name',
  handle(ws, { params, project }) {
    const branch = params.name ?? ''
    let conversationId: string | null = null
    let bufferingNotifications = true
    let socketClosed = false
    let streamSession: AgentsConversationStreamSession | null = null
    const bufferedNotifications: CodexAppServerNotification[] = []
    let unsubscribeClaudeStream: (() => void) | null = null
    log.debug(`[ws:agents] open branch=${branch}`)

    const unsubscribeNotifications = project.codexAppServerClient.onNotification((notification) => {
      if (bufferingNotifications || !streamSession) {
        bufferedNotifications.push(notification)
        return
      }

      const notificationThreadId = readAgentsNotificationThreadId(notification)
      if (!notificationThreadId || notificationThreadId !== conversationId) return
      streamSession.handleNotification(notification)
      conversationId = streamSession.currentConversationId()
    })
    let unsubscribe: (() => void) | null = () => {
      socketClosed = true
      streamSession?.close()
      unsubscribeNotifications()
      unsubscribeClaudeStream?.()
    }

    void (async (): Promise<void> => {
      const initialState = await loadAgentsConversationInitialState(project, branch)
      if (socketClosed) return
      if (!initialState.ok) {
        unsubscribeNotifications()
        sendAgentsWs(ws, { type: 'error', message: initialState.message })
        ws.close(1011, initialState.message.slice(0, 123))
        return
      }

      streamSession = new AgentsConversationStreamSession({
        conversationId: initialState.data.conversation.conversationId,
        nextOrder: nextConversationMessageOrder(initialState.data.conversation.messages),
        send: (event) => sendAgentsWs(ws, event),
      })
      conversationId = streamSession.currentConversationId()
      if (initialState.data.conversation.provider === 'claudeCode') {
        unsubscribeNotifications()
        unsubscribeClaudeStream = project.claudeConversationStreamService.subscribe(
          initialState.data.conversation.conversationId,
          streamSession,
        )
        return
      }

      if (initialState.data.conversation.provider !== 'codexAppServer') {
        unsubscribeNotifications()
        unsubscribe = null
        return
      }

      bufferingNotifications = false

      for (const notification of bufferedNotifications) {
        streamSession.handleNotification(notification)
        conversationId = streamSession.currentConversationId()
      }
    })()

    ws.on('message', (): void => {
      log.debug(`[ws:agents] ignoring inbound message branch=${branch}`)
    })

    ws.on('close', (code: number, reason: Buffer): void => {
      log.debug(`[ws:agents] close branch=${branch} code=${code} reason=${reason.toString()}`)
    })

    return (): void => {
      unsubscribe?.()
      unsubscribe = null
    }
  },
}
