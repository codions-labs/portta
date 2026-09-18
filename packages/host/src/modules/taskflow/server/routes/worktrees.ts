import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Hono } from 'hono'
import type { OneshotConfig } from 'portta-contracts/taskflow'
import type { OneshotMeta } from 'portta-core/taskflow'
import { isValidBranchName } from 'portta-core/taskflow'
import { RUNTIME_IDENTITY } from 'portta-core/taskflow/config'
import { sendPrompt as sendTerminalPrompt } from '../../adapters/terminal.ts'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { log } from '../../lib/log.ts'
import { buildSeedFromLinear, defaultSeedFromLinearDeps } from '../../services/conversation-export-service.ts'
import { touchDashboardActivity } from '../../services/dashboard-activity.ts'
import { environmentIdForWorkspace } from '../../services/environment-coordinator.ts'
import { buildCreateWorktreeTargets } from '../../services/lifecycle-service.ts'
import { createLinearIssue, fetchTeamByKey } from '../../services/linear-service.ts'
import { resolveLinearTicketTitle } from '../../services/linear-title-service.ts'
import { buildNativeTerminalLaunch, buildNativeTerminalTmuxCommand } from '../../services/native-terminal-service.ts'
import { describeHostRoute } from '../openapi.ts'
import type { ProjectApp } from '../project-app.ts'
import {
  type BodyOf,
  type ProjectRouteDeps,
  projectOf,
  projectRoute,
  projectRouter,
  worktreeName,
} from './project-router.ts'

const MAX_DIFF_BYTES = 200 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

async function apiGetNativeTerminalLaunch(project: ProjectApp, branch: string): Promise<Response> {
  touchDashboardActivity()
  project.ensureBranchNotBusy(branch)
  await project.runtime.reconciliationService.reconcile(project.runtime.projectDir)
  const state = project.runtime.projectRuntime.getWorktreeByBranch(branch)
  const launch = buildNativeTerminalLaunch({
    branch,
    state,
    tmuxCommand: buildNativeTerminalTmuxCommand(process.env),
    multiplexer: project.runtime.config.multiplexer,
    sessionPrefix: `${RUNTIME_IDENTITY.nativeTerminalSessionPrefix}-${project.port}-`,
  })
  if (!launch.ok) {
    return errorResponse(launch.message, launch.reason === 'not_found' ? 404 : 409)
  }
  // herdr's client always opens on the focused tab, so point it at this worktree
  // before handing the command over. tmux targets its window in the command itself.
  if (project.runtime.config.multiplexer === 'herdr' && state?.session.sessionName) {
    await project.runtime.sessions.focusWindow(state.session.sessionName, state.session.windowName)
  }
  return jsonResponse(launch.data)
}

async function apiGetWorktrees(project: ProjectApp): Promise<Response> {
  touchDashboardActivity()
  return jsonResponse({
    worktrees: (await project.readProjectSnapshot()).worktrees,
  })
}

async function apiCreateWorktree(project: ProjectApp, body: BodyOf<'createWorktree'>): Promise<Response> {
  const envOverrides = body.envOverrides && Object.keys(body.envOverrides).length > 0 ? body.envOverrides : undefined
  const branch = body.branch?.trim() ? body.branch.trim() : undefined
  const baseBranch = body.baseBranch?.trim() ? body.baseBranch.trim() : undefined
  const prompt = body.prompt?.trim() ? body.prompt.trim() : undefined
  const profile = body.profile
  const agent = body.agent
  const agents = body.agents
  const createLinearTicket = body.createLinearTicket === true
  const linearTitle = body.linearTitle?.trim() ? body.linearTitle.trim() : undefined
  // CreateWorktreeRequestSchema already trims, uppercases, and validates the
  // team key shape — body.linearTeamKey is either a valid key or undefined.
  const linearTeamKey = body.linearTeamKey
  const mode = body.mode
  const selectedAgents = agents ? agents : agent ? [agent] : [project.runtime.config.workspace.defaultAgent]

  if (baseBranch && !isValidBranchName(baseBranch)) {
    return errorResponse('Invalid base branch name', 400)
  }

  if (createLinearTicket && mode === 'existing') {
    return errorResponse('Linear ticket creation is only supported for new branches', 400)
  }

  if (baseBranch && mode === 'existing') {
    return errorResponse('Base branch is only supported for new branches', 400)
  }

  if (createLinearTicket && !project.runtime.config.integrations.linear.enabled) {
    return errorResponse('Linear integration is disabled', 400)
  }

  if (createLinearTicket && !project.runtime.config.integrations.linear.createTicketOption) {
    return errorResponse('Linear ticket creation is not enabled for this project', 400)
  }

  if (createLinearTicket && !prompt) {
    return errorResponse('Prompt is required when creating a Linear ticket', 400)
  }

  let resolvedBranch = branch
  let resolvedPrompt = prompt
  let resolvedMode = mode

  if (body.fromLinear) {
    if (createLinearTicket) {
      return errorResponse('fromLinear cannot be combined with createLinearTicket', 400)
    }
    let conversationContext = body.fromLinear.conversationContext?.trim() ?? ''
    let seedBranch: string | null = null
    if (!conversationContext || !resolvedBranch) {
      // Fall back to fetching the seed server-side when the client didn't pre-resolve it.
      // The CLI's `taskflow oneshot --linear` path resolves the seed in-process before
      // calling this endpoint and passes `conversationContext` + `branch` directly,
      // so this fetch only fires for dashboard/REST callers (no double round-trip).
      const seedResult = await buildSeedFromLinear({ issueId: body.fromLinear.issueId }, defaultSeedFromLinearDeps)
      if (!seedResult.ok) {
        return errorResponse(`Linear seed lookup failed: ${seedResult.error}`, seedResult.status)
      }
      if (!conversationContext && seedResult.data.conversationMarkdown) {
        conversationContext = seedResult.data.conversationMarkdown
      }
      seedBranch = seedResult.data.branch
      if (!resolvedBranch && seedBranch) {
        resolvedBranch = seedBranch
        // Use "existing" mode when the seed pointed to a real branch (avoids fresh-create).
        if (seedResult.data.source !== 'none') resolvedMode = 'existing'
      }
    }
    if (conversationContext) {
      resolvedPrompt = resolvedPrompt ? `${conversationContext}\n\n---\n\n${resolvedPrompt}` : conversationContext
    }
  }

  if (createLinearTicket) {
    const resolvedTitle = await resolveLinearTicketTitle({
      explicitTitle: linearTitle,
      prompt: prompt ?? '',
      autoName: project.runtime.config.autoName,
    })
    if (!resolvedTitle) {
      return errorResponse('Linear ticket title could not be derived from the prompt', 400)
    }

    if (!linearTeamKey) {
      return errorResponse('Linear team is required to create a ticket. Provide `linearTeamKey` (e.g. "ENG").', 400)
    }

    const teamResult = await fetchTeamByKey(linearTeamKey)
    if (!teamResult.ok) {
      return errorResponse(teamResult.error, teamResult.status)
    }

    const linearResult = await createLinearIssue({
      title: resolvedTitle.title,
      description: resolvedPrompt ?? '',
      teamId: teamResult.data.id,
    })
    if (!linearResult.ok) {
      return errorResponse(linearResult.error, 502)
    }

    resolvedBranch = linearResult.data.branchName
    log.info(
      `[linear] created ticket ${linearResult.data.identifier} branch=${linearResult.data.branchName} title="${linearResult.data.title.slice(0, 80)}" titleSource=${resolvedTitle.source}`,
    )
  }

  if (resolvedBranch) {
    const targetBranches = buildCreateWorktreeTargets(resolvedBranch, selectedAgents).map((target) => target.branch)
    for (const targetBranch of targetBranches) {
      project.ensureBranchNotBusy(targetBranch)
    }

    if (baseBranch && targetBranches.some((targetBranch) => targetBranch === baseBranch)) {
      return errorResponse('Base branch must differ from branch name', 400)
    }
  }

  const oneshot = normalizeOneshotConfig(body.oneshot)
  log.info(
    `[worktree:add] mode=${mode ?? 'new'}${resolvedBranch ? ` branch=${resolvedBranch}` : ''}${baseBranch ? ` base=${baseBranch}` : ''}${profile ? ` profile=${profile}` : ''} agents=${selectedAgents.join(',')}${createLinearTicket ? ' linearTicket=true' : ''}${prompt ? ` prompt="${prompt.slice(0, 80)}"` : ''}${oneshot ? ' oneshot=armed' : ''}`,
  )
  const result = await project.runtime.lifecycleService.createWorktrees({
    mode: resolvedMode,
    branch: resolvedBranch,
    baseBranch,
    prompt: resolvedPrompt,
    profile,
    ...(agents && agents.length > 0 ? { agents } : { agent }),
    envOverrides,
    ...(body.source ? { source: body.source } : {}),
    ...(oneshot ? { oneshot } : {}),
    ...(body.issueRef ? { issueRef: body.issueRef } : {}),
    interfaceMode: body.interfaceMode ?? 'terminal',
  })
  const profileName =
    profile ??
    (project.runtime.config.profiles.default
      ? 'default'
      : (Object.keys(project.runtime.config.profiles)[0] ?? 'default'))
  await Promise.all(
    result.branches.map(async (createdBranch) => {
      const worktree = project.runtime.projectRuntime.getWorktreeByBranch(createdBranch)
      if (!worktree) return
      const environment = await project.environments.prepareWorkspaceEnvironment({
        workspacePath: worktree.path,
        workspaceId: worktree.worktreeId,
        profileName,
        start: true,
      })
      if (!environment.ok) {
        log.info(
          `[environment:prepare] branch=${createdBranch} status=${environment.reason} ${environment.diagnostics.join('; ')}`,
        )
      }
    }),
  )
  if (resolvedPrompt) {
    for (const branch of result.branches) project.setBranchAgentLifecycle(branch, 'running')
  }
  log.debug(`[worktree:add] done branches=${result.branches.join(',')}`)
  return jsonResponse(
    {
      primaryBranch: result.primaryBranch,
      branches: result.branches,
    },
    201,
  )
}

async function apiDeleteWorktree(project: ProjectApp, name: string, force: boolean): Promise<Response> {
  return project.withRemovingBranch(name, async () => {
    log.info(`[worktree:rm] name=${name}`)
    const worktree = project.runtime.projectRuntime.getWorktreeByBranch(name)
    const environmentId = worktree
      ? environmentIdForWorkspace(project.environments.projectEnvironments(), worktree.worktreeId)
      : null
    const environment = environmentId ? project.environments.environmentForProject(environmentId) : null
    if (environment) await project.environments.destroyEnvironmentRecord(environment)
    await project.runtime.lifecycleService.removeWorktree(name, { force })
    log.debug(`[worktree:rm] done name=${name}`)
    return jsonResponse({ ok: true })
  })
}

async function apiOpenWorktree(project: ProjectApp, name: string, body: BodyOf<'openWorktree'>): Promise<Response> {
  project.ensureBranchNotBusy(name)
  const prompt = body.prompt?.trim() ? body.prompt.trim() : undefined
  const oneshot = normalizeOneshotConfig(body.oneshot)
  log.info(
    `[worktree:open] name=${name}${prompt ? ` prompt="${prompt.slice(0, 80)}"` : ''}${oneshot ? ' oneshot=armed' : ''}`,
  )
  // Intentionally NOT disarming here: opening a closed session is "let me peek
  // at the agent's progress", not "I'm taking over". The actual interaction
  // (terminal input, chat send, upload, etc.) is what fires disarm.
  return project.withMutatingTab(name, async () => {
    const result = await project.runtime.lifecycleService.openWorktree(name, {
      prompt,
      ...(oneshot ? { oneshot } : {}),
      ...(body.interfaceMode ? { interfaceMode: body.interfaceMode } : {}),
    })
    const worktree = project.runtime.projectRuntime.getWorktreeByBranch(name)
    if (worktree) {
      const environment = await project.environments.prepareWorkspaceEnvironment({
        workspacePath: worktree.path,
        workspaceId: worktree.worktreeId,
        profileName: worktree.profile,
        start: true,
      })
      if (!environment.ok) {
        log.info(
          `[environment:prepare] branch=${name} status=${environment.reason} ${environment.diagnostics.join('; ')}`,
        )
      }
    }
    if (prompt) project.setBranchAgentLifecycle(name, 'running')
    log.debug(`[worktree:open] done name=${name} worktreeId=${result.worktreeId}`)
    return jsonResponse({ ok: true })
  })
}

async function apiCloseWorktree(project: ProjectApp, name: string): Promise<Response> {
  project.ensureBranchNotBusy(name)
  log.info(`[worktree:close] name=${name}`)
  await project.disarmOneshotIfArmed(name, 'close-worktree')
  await project.runtime.lifecycleService.closeWorktree(name)
  log.debug(`[worktree:close] done name=${name}`)
  return jsonResponse({ ok: true })
}

async function apiSetWorktreeArchived(
  project: ProjectApp,
  name: string,
  body: BodyOf<'setWorktreeArchived'>,
): Promise<Response> {
  project.ensureBranchNotBusy(name)

  log.info(`[worktree:archive] name=${name} archived=${body.archived}`)
  await project.disarmOneshotIfArmed(name, 'archive-worktree')
  await project.runtime.lifecycleService.setWorktreeArchived(name, body.archived)
  log.debug(`[worktree:archive] done name=${name} archived=${body.archived}`)
  return jsonResponse({ ok: true, archived: body.archived })
}

async function apiCreateWorktreeTab(project: ProjectApp, name: string): Promise<Response> {
  return project.withMutatingTab(name, async () => {
    log.info(`[worktree:tab:create] name=${name}`)
    const result = await project.runtime.lifecycleService.createWorktreeTab(name)
    return jsonResponse({ tab: result.tab }, 201)
  })
}

async function apiSelectWorktreeTab(project: ProjectApp, name: string, tabId: string): Promise<Response> {
  return project.withMutatingTab(name, async () => {
    log.info(`[worktree:tab:select] name=${name} tab=${tabId}`)
    await project.runtime.lifecycleService.selectWorktreeTab(name, tabId)
    return jsonResponse({ ok: true })
  })
}

async function apiDeleteWorktreeTab(project: ProjectApp, name: string, tabId: string): Promise<Response> {
  return project.withMutatingTab(name, async () => {
    log.info(`[worktree:tab:delete] name=${name} tab=${tabId}`)
    await project.runtime.lifecycleService.deleteWorktreeTab(name, tabId)
    return jsonResponse({ ok: true })
  })
}

async function apiSetWorktreeLabel(
  project: ProjectApp,
  name: string,
  body: BodyOf<'setWorktreeLabel'>,
): Promise<Response> {
  project.ensureBranchNotBusy(name)

  log.info(`[worktree:label] name=${name} label=${body.label ? JSON.stringify(body.label) : 'null'}`)
  const result = await project.runtime.lifecycleService.setWorktreeLabel(name, body.label)
  log.debug(`[worktree:label] done name=${name} label=${result.label ? JSON.stringify(result.label) : 'null'}`)
  return jsonResponse({ ok: true, label: result.label })
}

async function apiSetWorktreeProfile(
  project: ProjectApp,
  name: string,
  body: BodyOf<'setWorktreeProfile'>,
): Promise<Response> {
  project.ensureBranchNotBusy(name)

  log.info(`[worktree:profile] name=${name} profile=${body.profile}`)
  const result = await project.runtime.lifecycleService.setWorktreeProfile(name, body.profile)
  log.debug(`[worktree:profile] done name=${name} profile=${result.profile} restarted=${result.restarted}`)
  return jsonResponse({ ok: true, profile: result.profile, restarted: result.restarted })
}

async function apiSendPrompt(project: ProjectApp, name: string, body: BodyOf<'sendWorktreePrompt'>): Promise<Response> {
  project.ensureBranchNotBusy(name)
  const text = body.text
  const preamble = body.preamble
  log.info(`[worktree:send] name=${name} text="${text.slice(0, 80)}"`)
  await project.disarmOneshotIfArmed(name, 'send-prompt')
  const terminalWorktree = await project.resolveTerminalWorktree(name)
  const submitDelayMs = project.resolveWorktreeTerminalSubmitDelayMs(terminalWorktree.agentName)
  const result = await sendTerminalPrompt(
    terminalWorktree.worktreeId,
    terminalWorktree.attachTarget,
    text,
    0,
    preamble,
    submitDelayMs,
  )
  if (!result.ok) return errorResponse(result.error, 503)
  project.setBranchAgentLifecycle(name, 'running')
  return jsonResponse({ ok: true })
}

async function apiMergeWorktree(project: ProjectApp, name: string): Promise<Response> {
  project.ensureBranchNotBusy(name)
  log.info(`[worktree:merge] name=${name}`)
  await project.disarmOneshotIfArmed(name, 'merge-worktree')
  await project.runtime.lifecycleService.mergeWorktree(name)
  log.debug(`[worktree:merge] done name=${name}`)
  return jsonResponse({ ok: true })
}

async function apiRefreshWorktreeAgentTerminal(project: ProjectApp, branch: string): Promise<Response> {
  touchDashboardActivity()
  return project.withMutatingTab(branch, async () => {
    await project.runtime.lifecycleService.refreshAgentTerminal(branch)
    return jsonResponse({ ok: true })
  })
}

async function apiGetWorktreeDiff(project: ProjectApp, name: string): Promise<Response> {
  await project.runtime.reconciliationService.reconcile(project.runtime.projectDir)
  const state = project.runtime.projectRuntime.getWorktreeByBranch(name)
  if (!state) return errorResponse(`Worktree not found: ${name}`, 404)

  const uncommitted = project.runtime.git.readDiff(state.path)
  const gitStatus = project.runtime.git.readStatus(state.path)
  const unpushedCommits = project.runtime.git.listUnpushedCommits(state.path)

  const truncated = uncommitted.length > MAX_DIFF_BYTES
  return jsonResponse({
    uncommitted: truncated ? uncommitted.slice(0, MAX_DIFF_BYTES) : uncommitted,
    uncommittedTruncated: truncated,
    gitStatus,
    unpushedCommits,
  })
}

function sanitizeFilename(name: string): string {
  // Strip directory components, replace unsafe chars
  const base = name.split('/').pop()?.split('\\').pop() ?? 'upload'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload'
}

async function apiUploadFiles(project: ProjectApp, name: string, req: Request): Promise<Response> {
  const state = project.runtime.projectRuntime.getWorktreeByBranch(name)
  if (!state) return errorResponse(`Worktree not found: ${name}`, 404)
  await project.disarmOneshotIfArmed(name, 'upload-files')

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return errorResponse('Invalid multipart form data', 400)
  }

  const entries = formData.getAll('files')
  if (entries.length === 0) return errorResponse('No files provided', 400)

  const uploadDir = join(tmpdir(), RUNTIME_IDENTITY.tempUploadDir, sanitizeFilename(name))
  mkdirSync(uploadDir, { recursive: true })

  const results: Array<{ path: string }> = []
  for (const entry of entries) {
    if (!(entry instanceof File)) continue
    if (!ALLOWED_IMAGE_TYPES.has(entry.type)) {
      return errorResponse(`Unsupported file type: ${entry.type}`, 400)
    }
    if (entry.size > MAX_FILE_SIZE) {
      return errorResponse(`File too large: ${entry.name} (max 10MB)`, 400)
    }
    const safeName = `${Date.now()}_${sanitizeFilename(entry.name)}`
    const destPath = join(uploadDir, safeName)
    if (!resolve(destPath).startsWith(`${uploadDir}/`)) {
      return errorResponse('Invalid filename', 400)
    }
    await writeFile(destPath, new Uint8Array(await entry.arrayBuffer()))
    results.push({ path: destPath })
  }

  log.info(`[upload] branch=${name} files=${results.length}`)
  return jsonResponse({ files: results })
}

/** Map the wire-side `OneshotConfig` (all-optional fields) to the persisted
 *  `OneshotMeta` shape (autoCloseOnDone has a definite boolean). Default is
 *  `true` — callers must opt out explicitly. */
function normalizeOneshotConfig(input: OneshotConfig | undefined): OneshotMeta | undefined {
  if (!input) return undefined
  return {
    autoCloseOnDone: input.autoCloseOnDone ?? true,
    ...(input.postToLinearOnDone ? { postToLinearOnDone: input.postToLinearOnDone } : {}),
  }
}

export function worktreeRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchWorktrees', 'Worktrees', (project) => apiGetWorktrees(project))

  projectRoute(app, deps, 'createWorktree', 'Worktrees', (project, { body }) => apiCreateWorktree(project, body))

  projectRoute(app, deps, 'removeWorktree', 'Worktrees', (project, { params, query }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiDeleteWorktree(project, name, query.force === true)
  })

  projectRoute(app, deps, 'openWorktree', 'Worktrees', (project, { params, body }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiOpenWorktree(project, name, body)
  })

  projectRoute(app, deps, 'closeWorktree', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiCloseWorktree(project, name)
  })

  projectRoute(app, deps, 'refreshWorktreeAgentTerminal', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiRefreshWorktreeAgentTerminal(project, name)
  })

  projectRoute(app, deps, 'setWorktreeArchived', 'Worktrees', (project, { params, body }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiSetWorktreeArchived(project, name, body)
  })

  projectRoute(app, deps, 'setWorktreeLabel', 'Worktrees', (project, { params, body }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiSetWorktreeLabel(project, name, body)
  })

  projectRoute(app, deps, 'setWorktreeProfile', 'Worktrees', (project, { params, body }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiSetWorktreeProfile(project, name, body)
  })

  projectRoute(app, deps, 'sendWorktreePrompt', 'Worktrees', (project, { params, body }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiSendPrompt(project, name, body)
  })

  projectRoute(app, deps, 'createWorktreeTab', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiCreateWorktreeTab(project, name)
  })

  projectRoute(app, deps, 'selectWorktreeTab', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiSelectWorktreeTab(project, name, params.tabId)
  })

  projectRoute(app, deps, 'deleteWorktreeTab', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiDeleteWorktreeTab(project, name, params.tabId)
  })

  projectRoute(app, deps, 'mergeWorktree', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiMergeWorktree(project, name)
  })

  projectRoute(app, deps, 'fetchWorktreeDiff', 'Worktrees', (project, { params }) => {
    const name = worktreeName(params.name)
    return name instanceof Response ? name : apiGetWorktreeDiff(project, name)
  })

  app.get(
    '/api/worktrees/:name/terminal-launch',
    describeHostRoute({
      tag: 'Worktrees',
      operationId: 'fetchWorktreeTerminalLaunch',
      summary: 'Describe the native terminal command that attaches to a worktree session',
      responses: [200, 400, 404, 409],
    }),
    (c) => {
      const project = projectOf(deps, c)
      if (project instanceof Response) return project
      const name = worktreeName(c.req.param('name'))
      return name instanceof Response ? name : apiGetNativeTerminalLaunch(project, name)
    },
  )

  app.post(
    '/api/worktrees/:name/upload',
    describeHostRoute({
      tag: 'Worktrees',
      operationId: 'uploadWorktreeFiles',
      summary: 'Upload images for a worktree prompt as multipart `files`',
      responses: [200, 400, 404],
    }),
    (c) => {
      const project = projectOf(deps, c)
      if (project instanceof Response) return project
      const name = worktreeName(c.req.param('name'))
      return name instanceof Response ? name : apiUploadFiles(project, name, c.req.raw)
    },
  )

  return app
}
