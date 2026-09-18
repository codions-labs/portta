import type { Hono } from 'hono'
import { persistLocalCustomAgent, removeLocalCustomAgent } from '../../adapters/config.ts'
import { interruptPrompt, sendPrompt as sendTerminalPrompt } from '../../adapters/terminal.ts'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { isBuiltInAgentId, listAgentDetails, normalizeCustomAgentId } from '../../services/agent-registry.ts'
import { validateCustomAgentInput } from '../../services/agent-validation-service.ts'
import { touchDashboardActivity } from '../../services/dashboard-activity.ts'
import type { ProjectApp } from '../project-app.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter, worktreeName } from './project-router.ts'

function agentId(id: string): string | Response {
  const trimmed = id.trim()
  return trimmed ? trimmed : errorResponse('Invalid agent id', 400)
}

async function apiAttachAgentsWorktree(project: ProjectApp, branch: string): Promise<Response> {
  touchDashboardActivity()
  const resolved = await project.resolveAgentsWorktree(branch)
  if (!resolved.ok) return resolved.response

  const chatSupport = project.resolveWorktreeAgentChatSupport(resolved.worktree, 'chat')
  if (!chatSupport.ok) {
    return errorResponse(chatSupport.error, chatSupport.status)
  }

  const result =
    chatSupport.data.provider === 'claude'
      ? await project.claudeConversationService.attachWorktreeConversation(resolved.worktree)
      : await project.worktreeConversationService.attachWorktreeConversation(resolved.worktree)
  return result.ok
    ? jsonResponse(project.withClaudeLiveConversation(result.data))
    : errorResponse(result.error, result.status)
}

async function apiGetAgentsWorktreeHistory(project: ProjectApp, branch: string): Promise<Response> {
  touchDashboardActivity()
  const resolved = await project.resolveAgentsWorktree(branch)
  if (!resolved.ok) return resolved.response

  const chatSupport = project.resolveWorktreeAgentChatSupport(resolved.worktree, 'chat')
  if (!chatSupport.ok) {
    return errorResponse(chatSupport.error, chatSupport.status)
  }

  const result =
    chatSupport.data.provider === 'claude'
      ? await project.claudeConversationService.readWorktreeConversation(resolved.worktree)
      : await project.worktreeConversationService.readWorktreeConversation(resolved.worktree)
  return result.ok
    ? jsonResponse(project.withClaudeLiveConversation(result.data))
    : errorResponse(result.error, result.status)
}

async function apiSendAgentsWorktreeMessage(project: ProjectApp, branch: string, text: string): Promise<Response> {
  touchDashboardActivity()
  await project.disarmOneshotIfArmed(branch, 'agents-send-message')

  const resolved = await project.resolveAgentsWorktree(branch)
  if (!resolved.ok) return resolved.response
  if (!resolved.worktree.mux) {
    return errorResponse('Open this worktree in the main dashboard before sending messages here', 409)
  }

  const chatSupport = project.resolveWorktreeAgentChatSupport(resolved.worktree, 'chat')
  if (!chatSupport.ok) {
    return errorResponse(chatSupport.error, chatSupport.status)
  }

  if (chatSupport.data.provider === 'codex') {
    const sendResult = await project.worktreeConversationService.sendWorktreeConversationMessage(
      resolved.worktree,
      text,
    )
    if (!sendResult.ok) {
      return errorResponse(sendResult.error, sendResult.status)
    }
    await project.setAgentTerminalStale(resolved.worktree, true)
    return jsonResponse(sendResult.data)
  }

  const conversationResult = await project.claudeConversationService.readWorktreeConversation(resolved.worktree)
  if (!conversationResult.ok) {
    return errorResponse(conversationResult.error, conversationResult.status)
  }

  const streamingResponse = await project.sendClaudeStreamingMessage({
    worktree: resolved.worktree,
    text,
    conversationId: conversationResult.data.conversation.conversationId,
  })
  if (streamingResponse) return streamingResponse

  const terminalWorktree = await project.resolveAgentsTerminalWorktree(branch)
  if (!terminalWorktree.ok) return terminalWorktree.response
  const sendResult = await sendTerminalPrompt(
    terminalWorktree.data.worktreeId,
    terminalWorktree.data.attachTarget,
    text,
    0,
    undefined,
    chatSupport.data.submitDelayMs,
  )
  if (!sendResult.ok) {
    return errorResponse(sendResult.error, 503)
  }

  // tmux send has no real turn id yet; history replaces this optimistic placeholder on refresh.
  return jsonResponse({
    conversationId: conversationResult.data.conversation.conversationId,
    turnId: `tmux:${crypto.randomUUID()}`,
    running: true,
    streaming: false,
  })
}

async function apiInterruptAgentsWorktree(project: ProjectApp, branch: string): Promise<Response> {
  touchDashboardActivity()
  await project.disarmOneshotIfArmed(branch, 'agents-interrupt')
  const resolved = await project.resolveAgentsWorktree(branch)
  if (!resolved.ok) return resolved.response
  if (!resolved.worktree.mux) {
    return errorResponse('Open this worktree in the main dashboard before interrupting it here', 409)
  }

  const chatSupport = project.resolveWorktreeAgentChatSupport(resolved.worktree, 'interrupt')
  if (!chatSupport.ok) {
    return errorResponse(chatSupport.error, chatSupport.status)
  }

  if (chatSupport.data.provider === 'codex') {
    const interruptResult = await project.worktreeConversationService.interruptWorktreeConversation(resolved.worktree)
    if (!interruptResult.ok) {
      return errorResponse(interruptResult.error, interruptResult.status)
    }
    await project.setAgentTerminalStale(resolved.worktree, true)
    return jsonResponse(interruptResult.data)
  }

  const conversationResult = await project.claudeConversationService.readWorktreeConversation(resolved.worktree)
  if (!conversationResult.ok) {
    return errorResponse(conversationResult.error, conversationResult.status)
  }
  const activeClaudeInterrupt = project.claudeConversationStreamService.interrupt(
    conversationResult.data.conversation.conversationId,
  )
  if (activeClaudeInterrupt.ok) {
    await project.setAgentTerminalStale(resolved.worktree, true)
    return jsonResponse({
      conversationId: conversationResult.data.conversation.conversationId,
      turnId: activeClaudeInterrupt.turnId,
      interrupted: true,
      streaming: true,
    })
  }

  const terminalWorktree = await project.resolveAgentsTerminalWorktree(branch)
  if (!terminalWorktree.ok) return terminalWorktree.response
  const interruptResult = await interruptPrompt(terminalWorktree.data.attachTarget, 0)
  if (!interruptResult.ok) {
    return errorResponse(interruptResult.error, 503)
  }

  return jsonResponse({
    conversationId: conversationResult.data.conversation.conversationId,
    turnId: conversationResult.data.conversation.activeTurnId ?? `tmux:${crypto.randomUUID()}`,
    interrupted: true,
    streaming: false,
  })
}

export function agentRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchAgents', 'Agents', ({ runtime }) =>
    jsonResponse({ agents: listAgentDetails(runtime.config) }),
  )

  projectRoute(app, deps, 'validateAgent', 'Agents', (_project, { body }) =>
    jsonResponse(validateCustomAgentInput(body)),
  )

  projectRoute(app, deps, 'createAgent', 'Agents', async ({ runtime: { config, projectDir } }, { body }) => {
    const id = normalizeCustomAgentId(body.label)
    if (isBuiltInAgentId(id) || config.agents[id]) {
      return errorResponse(`Agent already exists: ${id}`, 409)
    }

    const agentConfig = {
      label: body.label,
      startCommand: body.startCommand,
      ...(body.resumeCommand?.trim() ? { resumeCommand: body.resumeCommand.trim() } : {}),
    }
    await persistLocalCustomAgent(projectDir, id, agentConfig)
    config.agents[id] = agentConfig

    const agent = listAgentDetails(config).find((entry) => entry.id === id)
    if (!agent) {
      return errorResponse(`Created agent could not be loaded: ${id}`, 500)
    }
    return jsonResponse({ agent })
  })

  projectRoute(app, deps, 'updateAgent', 'Agents', async ({ runtime: { config, projectDir } }, { params, body }) => {
    const id = agentId(params.id)
    if (id instanceof Response) return id
    if (isBuiltInAgentId(id)) {
      return errorResponse(`Built-in agent cannot be edited: ${id}`, 400)
    }
    if (!config.agents[id]) {
      return errorResponse(`Unknown agent: ${id}`, 404)
    }

    const agentConfig = {
      label: body.label,
      startCommand: body.startCommand,
      ...(body.resumeCommand?.trim() ? { resumeCommand: body.resumeCommand.trim() } : {}),
    }
    await persistLocalCustomAgent(projectDir, id, agentConfig)
    config.agents[id] = agentConfig

    const agent = listAgentDetails(config).find((entry) => entry.id === id)
    if (!agent) {
      return errorResponse(`Updated agent could not be loaded: ${id}`, 500)
    }
    return jsonResponse({ agent })
  })

  projectRoute(app, deps, 'deleteAgent', 'Agents', async ({ runtime: { config, projectDir } }, { params }) => {
    const id = agentId(params.id)
    if (id instanceof Response) return id
    if (isBuiltInAgentId(id)) {
      return errorResponse(`Built-in agent cannot be deleted: ${id}`, 400)
    }
    if (!config.agents[id]) {
      return errorResponse(`Unknown agent: ${id}`, 404)
    }

    await removeLocalCustomAgent(projectDir, id)
    delete config.agents[id]
    return jsonResponse({ ok: true })
  })

  projectRoute(app, deps, 'attachAgentsWorktreeConversation', 'Agents', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiAttachAgentsWorktree(project, name)
  })

  projectRoute(app, deps, 'fetchAgentsWorktreeConversationHistory', 'Agents', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiGetAgentsWorktreeHistory(project, name)
  })

  projectRoute(app, deps, 'sendAgentsWorktreeConversationMessage', 'Agents', (project, { params, body }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiSendAgentsWorktreeMessage(project, name, body.text)
  })

  projectRoute(app, deps, 'interruptAgentsWorktreeConversation', 'Agents', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiInterruptAgentsWorktree(project, name)
  })

  return app
}
