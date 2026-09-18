import { randomUUID } from 'node:crypto'
import type { JsonValue, SessionCapability } from 'portta-contracts/taskflow'
import type { ProjectConfig } from 'portta-core/taskflow'
import {
  captureNewSessionId,
  type DiscoverableAgentKind,
  type SessionDiscoveryGateway,
} from '../adapters/session-discovery.ts'
import {
  buildPaneTarget,
  buildProjectSessionName,
  buildWorktreeWindowName,
  type SessionGateway,
} from '../adapters/session-gateway.ts'
import { getAgentDefinition } from './agent-registry.ts'
import { buildAgentPaneCommand } from './agent-service.ts'
import type {
  DirectSessionPort,
  DirectSessionResumeInput,
  DirectSessionStartInput,
  DirectSessionState,
} from './direct-session-port.ts'
import type { RunEnvironmentPort } from './run-environment-port.ts'

interface ActiveSession {
  sessionName: string
  windowName: string
  cwd: string
  agentKind: DiscoverableAgentKind | null
  state: DirectSessionState
}

export interface TaskflowDirectSessionServiceDependencies {
  config: Pick<ProjectConfig, 'agents'>
  projectRoot: string
  sessions: SessionGateway
  sessionDiscovery: SessionDiscoveryGateway
  environments?: Pick<RunEnvironmentPort, 'terminalCommand' | 'workspace'>
}

function promptFor(input: JsonValue): string {
  return typeof input === 'string' ? input : JSON.stringify(input)
}

function capabilities(
  agent: NonNullable<ReturnType<typeof getAgentDefinition>>,
  environmentId: string | null,
): SessionCapability {
  return {
    terminal: agent.capabilities.terminal,
    interactiveInput: agent.capabilities.terminal,
    interrupt: agent.capabilities.interrupt,
    resume:
      agent.capabilities.resume &&
      !(environmentId && agent.kind === 'builtin' && agent.implementation.agent === 'codex'),
  }
}

function discoverableKind(agent: NonNullable<ReturnType<typeof getAgentDefinition>>): DiscoverableAgentKind | null {
  if (agent.kind !== 'builtin') return null
  return agent.implementation.agent
}

export class TaskflowDirectSessionService implements DirectSessionPort {
  private readonly active = new Map<string, ActiveSession>()

  private readonly deps: TaskflowDirectSessionServiceDependencies
  constructor(deps: TaskflowDirectSessionServiceDependencies) {
    this.deps = deps
  }

  private commandFor(environmentId: string | null, command: string): string {
    return environmentId && this.deps.environments
      ? this.deps.environments.terminalCommand(environmentId, command)
      : command
  }

  private pathsFor(environmentId: string | null, workspacePath: string): { repoRoot: string; worktreePath: string } {
    if (!environmentId || !this.deps.environments) {
      return { repoRoot: this.deps.projectRoot, worktreePath: workspacePath }
    }
    const environmentWorkspace = this.deps.environments.workspace(environmentId)
    const containerPath = environmentWorkspace.containerPath ?? workspacePath
    return { repoRoot: containerPath, worktreePath: containerPath }
  }

  async start(input: DirectSessionStartInput): Promise<DirectSessionState> {
    if (input.transport === 'acp') throw new Error('TaskflowDirectSessionService only supports native sessions')
    const agent = getAgentDefinition(this.deps.config, input.harness)
    if (agent === null) throw new Error(`Unknown Direct Run harness: ${input.harness}`)
    const environmentSession = input.run.environmentId !== null
    const agentKind = environmentSession ? null : discoverableKind(agent)
    const pinnedSessionId =
      environmentSession && agent.kind === 'builtin' && agent.implementation.agent === 'claude' ? randomUUID() : null
    const previousSessionIds = agentKind
      ? await this.deps.sessionDiscovery.listSessionIds(agentKind, input.workspace.path)
      : []

    const sessionName = buildProjectSessionName(this.deps.projectRoot)
    const windowName = buildWorktreeWindowName(input.workspace.branch)
    const paths = this.pathsFor(input.run.environmentId, input.workspace.path)
    if (await this.deps.sessions.hasWindow(sessionName, windowName)) {
      throw new Error(`Direct Run window already exists: ${windowName}`)
    }

    await this.deps.sessions.ensureServer()
    await this.deps.sessions.ensureSession(sessionName, input.workspace.path)
    await this.deps.sessions.createWindow({
      sessionName,
      windowName,
      cwd: input.workspace.path,
      command: this.commandFor(
        input.run.environmentId,
        buildAgentPaneCommand({
          agent,
          repoRoot: paths.repoRoot,
          worktreePath: paths.worktreePath,
          branch: input.workspace.branch,
          profileName: input.run.profile ?? 'default',
          model: input.model ?? undefined,
          prompt: promptFor(input.run.input),
          pinSessionId: pinnedSessionId ?? undefined,
        }),
      ),
    })
    const paneId = await this.deps.sessions.getPaneId(buildPaneTarget(sessionName, windowName, 0))
    const sessionId =
      pinnedSessionId ??
      (agentKind
        ? await captureNewSessionId(this.deps.sessionDiscovery, agentKind, input.workspace.path, previousSessionIds)
        : paneId)
    if (sessionId === null) {
      await this.deps.sessions.killWindow(sessionName, windowName)
      throw new Error(`Unable to discover ${agentKind} session for Direct Run`)
    }
    const state: DirectSessionState = {
      sessionId,
      checkpoint: null,
      capabilities: capabilities(agent, input.run.environmentId),
      active: true,
      activity: 'running',
    }
    this.active.set(sessionId, { sessionName, windowName, cwd: input.workspace.path, agentKind, state })
    return state
  }

  async cancel(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId)
    if (active === undefined) throw new Error(`Direct Run session was not found: ${sessionId}`)
    await this.deps.sessions.killWindow(active.sessionName, active.windowName)
    this.active.set(sessionId, { ...active, state: { ...active.state, active: false } })
  }

  async resume(input: DirectSessionResumeInput): Promise<DirectSessionState> {
    if (input.transport === 'acp') throw new Error('TaskflowDirectSessionService only supports native sessions')
    const agent = getAgentDefinition(this.deps.config, input.harness)
    if (agent === null) throw new Error(`Unknown Direct Run harness: ${input.harness}`)
    if (!agent.capabilities.resume) throw new Error(`Direct Run harness cannot resume: ${input.harness}`)

    const sessionName = buildProjectSessionName(this.deps.projectRoot)
    const windowName = buildWorktreeWindowName(input.workspace.branch)
    const paths = this.pathsFor(input.run.environmentId, input.workspace.path)
    if (await this.deps.sessions.hasWindow(sessionName, windowName)) {
      throw new Error(`Direct Run window already exists: ${windowName}`)
    }

    await this.deps.sessions.ensureServer()
    await this.deps.sessions.ensureSession(sessionName, input.workspace.path)
    await this.deps.sessions.createWindow({
      sessionName,
      windowName,
      cwd: input.workspace.path,
      command: this.commandFor(
        input.run.environmentId,
        buildAgentPaneCommand({
          agent,
          repoRoot: paths.repoRoot,
          worktreePath: paths.worktreePath,
          branch: input.workspace.branch,
          profileName: input.run.profile ?? 'default',
          model: input.model ?? undefined,
          launchMode: 'resume',
          resumeConversationId: input.sessionId,
        }),
      ),
    })
    const state: DirectSessionState = {
      sessionId: input.sessionId,
      checkpoint: null,
      capabilities: capabilities(agent, input.run.environmentId),
      active: true,
      activity: 'running',
    }
    this.active.set(input.sessionId, {
      sessionName,
      windowName,
      cwd: input.workspace.path,
      agentKind: input.run.environmentId ? null : discoverableKind(agent),
      state,
    })
    return state
  }

  async inspect(sessionId: string): Promise<DirectSessionState | null> {
    const active = this.active.get(sessionId)
    if (active === undefined) return null
    const isActive = await this.deps.sessions.hasWindow(active.sessionName, active.windowName)
    const activity =
      isActive && active.agentKind && this.deps.sessionDiscovery.inspectSessionActivity
        ? ((await this.deps.sessionDiscovery.inspectSessionActivity(active.agentKind, active.cwd, sessionId)) ??
          active.state.activity)
        : active.state.activity
    return { ...active.state, active: isActive, activity }
  }
}
