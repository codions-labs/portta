import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Hono } from 'hono'
import {
  ExecutionIdParamsSchema,
  ExecutionTranscriptQuerySchema,
  RunEventsQuerySchema,
  TaskflowRunIdParamsSchema,
  WorkflowWorkspacePolicySchema,
  type WorkspaceSelection,
} from 'portta-contracts/taskflow'
import { getDefaultProfileName } from '../../adapters/config.ts'
import { canonicalizeFsPath } from '../../adapters/git.ts'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { getAgentDefinition } from '../../services/agent-registry.ts'
import { parseQuery, parseValue } from '../api-validation.ts'
import { describeHostRoute } from '../openapi.ts'
import type { ProjectApp } from '../project-app.ts'
import { type BodyOf, type ProjectRouteDeps, projectOf, projectRoute, projectRouter } from './project-router.ts'

const CONFLICT_REASONS = [
  'branch_conflict',
  'workspace_path_conflict',
  'checkout_busy',
  'dirty_workspace',
  'detached_head',
]

const SSE_HEADERS = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }

function projectRun(project: ProjectApp, runId: string): boolean {
  const detail = project.runs.presentation.detail(runId)
  return detail !== null && detail.run.projectId === project.prefix
}

function apiGetRunWorkspaceContext(project: ProjectApp): Response {
  const { git, projectDir } = project.runtime
  const path = canonicalizeFsPath(projectDir)
  const branch = git.currentBranch(projectDir) || null
  const claims = project.runs.store.listCheckoutClaims(project.prefix, path)
  return jsonResponse({
    path,
    branch,
    headCommit: branch === null ? null : git.resolveCommit(projectDir, 'HEAD'),
    dirty: git.readStatus(projectDir).length > 0,
    activeReaders: claims.filter((claim) => claim.access === 'shared_read').length,
    activeWriterRunId: claims.find((claim) => claim.access === 'exclusive_write')?.runId ?? null,
  })
}

function apiStreamRunEvents(project: ProjectApp, runId: string, req: Request): Response {
  if (!projectRun(project, runId)) return errorResponse('Run not found', 404)
  const parsed = parseQuery(req, RunEventsQuerySchema)
  if (!parsed.ok) return parsed.response
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      const replay = project.runs.presentation.events(runId, parsed.data.after)
      replay?.events.forEach((event) => {
        controller.enqueue(encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`))
      })
      unsubscribe = project.runs.subscribe((event): void => {
        if (event.runId === runId)
          controller.enqueue(encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`))
      })
    },
    cancel(): void {
      unsubscribe?.()
    },
  })
  req.signal.addEventListener(
    'abort',
    (): void => {
      unsubscribe?.()
    },
    { once: true },
  )
  return new Response(stream, { headers: SSE_HEADERS })
}

function projectExecution(project: ProjectApp, executionId: string): boolean {
  const execution = project.runs.store.getExecution(executionId)
  const run = execution === null ? null : project.runs.store.getRun(execution.runId)
  return run !== null && run.projectId === project.prefix
}

function apiStreamExecutionTranscript(project: ProjectApp, executionId: string, req: Request): Response {
  if (!projectExecution(project, executionId)) return errorResponse('Execution not found', 404)
  const parsed = parseQuery(req, ExecutionTranscriptQuerySchema)
  if (!parsed.ok) return parsed.response
  const encoder = new TextEncoder()
  let closed = false
  let cursor = parsed.data.after ?? 0
  const stream = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      let lastPing = Date.now()
      while (!closed && !req.signal.aborted) {
        const result = await project.runs.transcripts.read(executionId, cursor)
        if (!result.ok) {
          controller.error(new Error('Transcript unavailable'))
          return
        }
        for (const entry of result.response.entries) {
          cursor = entry.cursor
          controller.enqueue(encoder.encode(`id: ${entry.cursor}\ndata: ${JSON.stringify(entry)}\n\n`))
        }
        cursor = Math.max(cursor, result.response.nextCursor)
        if (Date.now() - lastPing >= 20_000) {
          controller.enqueue(encoder.encode(': ping\n\n'))
          lastPing = Date.now()
        }
        await delay(500, undefined, { signal: req.signal }).catch((): void => {})
      }
      if (!closed) controller.close()
    },
    cancel(): void {
      closed = true
    },
  })
  req.signal.addEventListener(
    'abort',
    (): void => {
      closed = true
    },
    { once: true },
  )
  return new Response(stream, { headers: SSE_HEADERS })
}

async function apiCreateProjectRun(project: ProjectApp, body: BodyOf<'createProjectRun'>): Promise<Response> {
  const { config, git, projectDir } = project.runtime
  const { service: runService, presentation: runPresentation } = project.runs
  const profile = body.profile ?? getDefaultProfileName(config)
  const configuredProfile = config.profiles[profile]
  if (!configuredProfile) return errorResponse(`Profile not found: ${profile}`, 400)
  if (body.mode === 'direct') {
    if (getAgentDefinition(config, body.harness) === null)
      return errorResponse(`Unknown Direct Run harness: ${body.harness}`, 400)
    const result = await runService.createDirect({
      id: `run_${randomUUID()}`,
      projectId: project.prefix,
      input: body.input,
      operationId: body.idempotencyKey,
      harness: body.harness,
      provider: body.provider ?? null,
      model: body.model ?? null,
      profile,
      transport: body.transport ?? 'native',
      permissionMode: body.permissionMode ?? 'interactive',
      mcpServers: body.mcpServers ?? [],
      projectRoot: projectDir,
      workspaceRoot: resolve(projectDir, config.workspace.worktreeRoot),
      baseBranch: config.workspace.mainBranch,
      baseCommit: git.currentBranch(projectDir),
      agent: config.workspace.defaultAgent,
      runtime: configuredProfile.runtime,
      workspace: body.workspace ?? { strategy: 'isolated_worktree' },
      access: 'exclusive_write',
      issueRef: body.issueRef ?? null,
    })
    if (!result.ok) return errorResponse(result.reason, CONFLICT_REASONS.includes(result.reason) ? 409 : 503)
    const detail = runPresentation.detail(result.run.id)
    return detail === null ? errorResponse('Run was not persisted', 500) : jsonResponse(detail, 201)
  }
  const runId = `run_${randomUUID()}`
  const snapshot = await project.runs.workflowCatalog.createSnapshot({
    id: `snapshot_${randomUUID()}`,
    runId,
    name: body.workflowId,
    createdAt: new Date().toISOString(),
  })
  if (!snapshot.ok)
    return errorResponse(snapshot.diagnostic.message, snapshot.diagnostic.code === 'not_found' ? 404 : 409)
  const policy = WorkflowWorkspacePolicySchema.parse(
    typeof snapshot.snapshot.metadata === 'object' &&
      snapshot.snapshot.metadata !== null &&
      !Array.isArray(snapshot.snapshot.metadata)
      ? snapshot.snapshot.metadata.workspace
      : undefined,
  )
  const workspace: WorkspaceSelection = body.workspace ?? { strategy: policy.default }
  if (!policy.allowed.includes(workspace.strategy)) {
    return errorResponse(`Workspace strategy ${workspace.strategy} is not allowed by this workflow`, 409)
  }
  const result = await runService.createWorkflow({
    id: runId,
    projectId: project.prefix,
    input: body.input,
    operationId: body.idempotencyKey,
    snapshot: snapshot.snapshot,
    dataRoot: project.runs.dataRoot,
    projectRoot: projectDir,
    workspaceRoot: resolve(projectDir, config.workspace.worktreeRoot),
    baseBranch: config.workspace.mainBranch,
    baseCommit: git.currentBranch(projectDir),
    profile,
    agent: config.workspace.defaultAgent,
    runtime: configuredProfile.runtime,
    workspace,
    access: workspace.strategy === 'current_branch' && !policy.mutatesRepository ? 'shared_read' : 'exclusive_write',
    transport: body.transport ?? 'native',
    permissionMode: body.permissionMode ?? 'workspace',
    mcpServers: body.mcpServers ?? [],
    issueRef: body.issueRef ?? null,
  })
  if (!result.ok) return errorResponse(result.reason, CONFLICT_REASONS.includes(result.reason) ? 409 : 503)
  const detail = runPresentation.detail(result.run.id)
  return detail === null ? errorResponse('Run was not persisted', 500) : jsonResponse(detail, 201)
}

export function runRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchProjectWorkflows', 'Runs', async (project, { params }) =>
    params.projectId === project.prefix
      ? jsonResponse(await project.runs.presentation.workflows(project.runs.workflowCatalog))
      : errorResponse('Project not found', 404),
  )

  projectRoute(app, deps, 'fetchRunWorkspaceContext', 'Runs', (project, { params }) =>
    params.projectId === project.prefix ? apiGetRunWorkspaceContext(project) : errorResponse('Project not found', 404),
  )

  projectRoute(app, deps, 'fetchProjectRuns', 'Runs', (project, { params }) =>
    params.projectId === project.prefix
      ? jsonResponse(project.runs.presentation.list(project.prefix))
      : errorResponse('Project not found', 404),
  )

  projectRoute(app, deps, 'createProjectRun', 'Runs', (project, { params, body }) =>
    params.projectId === project.prefix ? apiCreateProjectRun(project, body) : errorResponse('Project not found', 404),
  )

  projectRoute(app, deps, 'fetchRun', 'Runs', (project, { params }) => {
    const detail = project.runs.presentation.detail(params.runId)
    if (detail === null || detail.run.projectId !== project.prefix) return errorResponse('Run not found', 404)
    return jsonResponse(detail)
  })

  projectRoute(app, deps, 'fetchRunEvents', 'Runs', (project, { params, query }) => {
    if (!projectRun(project, params.runId)) return errorResponse('Run not found', 404)
    return jsonResponse(project.runs.presentation.events(params.runId, query.after))
  })

  projectRoute(app, deps, 'cancelRun', 'Runs', async (project, { params: { runId } }) => {
    const detail = project.runs.presentation.detail(runId)
    if (detail === null || detail.run.projectId !== project.prefix) return errorResponse('Run not found', 404)
    const result =
      detail.run.mode === 'workflow'
        ? await project.runs.service.cancelWorkflow(runId)
        : await project.runs.service.cancel(runId)
    if (!result.ok) return errorResponse(result.reason, result.reason === 'not_found' ? 404 : 409)
    return jsonResponse(project.runs.presentation.detail(runId))
  })

  projectRoute(app, deps, 'resumeRun', 'Runs', async (project, { params: { runId } }) => {
    const detail = project.runs.presentation.detail(runId)
    if (detail === null || detail.run.projectId !== project.prefix) return errorResponse('Run not found', 404)
    const result =
      detail.run.mode === 'workflow'
        ? await project.runs.service.resumeWorkflow(runId)
        : await project.runs.service.resume(runId)
    if (!result.ok) return errorResponse(result.reason, result.reason === 'not_found' ? 404 : 409)
    return jsonResponse(project.runs.presentation.detail(runId))
  })

  projectRoute(app, deps, 'respondRunPermission', 'Runs', async (project, { params: { runId }, body }) => {
    const detail = project.runs.presentation.detail(runId)
    if (detail === null || detail.run.projectId !== project.prefix) return errorResponse('Run not found', 404)
    if (detail.run.mode !== 'direct') return errorResponse('Only Direct Runs accept ACP permission responses', 409)
    const result = await project.runs.service.respondPermission(runId, body.requestId, body.optionId)
    if (!result.ok) return errorResponse(result.reason, result.reason === 'not_found' ? 404 : 409)
    return jsonResponse(project.runs.presentation.detail(runId))
  })

  projectRoute(app, deps, 'fetchExecutionTranscript', 'Runs', async (project, { params, query }) => {
    if (!projectExecution(project, params.executionId)) return errorResponse('Execution not found', 404)
    const result = await project.runs.transcripts.read(params.executionId, query.after)
    if (!result.ok)
      return errorResponse(
        result.reason === 'not_found' ? 'Execution not found' : 'Transcript unavailable',
        result.reason === 'not_found' ? 404 : 409,
      )
    return jsonResponse(result.response)
  })

  app.get(
    '/api/runs/:runId/stream',
    describeHostRoute({
      tag: 'Runs',
      operationId: 'streamRunEvents',
      summary: 'Replay, then follow, the events of a Run as server-sent events',
      mediaType: 'text/event-stream',
      responses: [200, 400, 404],
    }),
    (c) => {
      const project = projectOf(deps, c)
      if (project instanceof Response) return project
      const parsed = parseValue(TaskflowRunIdParamsSchema, c.req.param(), 'Invalid path parameters')
      return parsed.ok ? apiStreamRunEvents(project, parsed.data.runId, c.req.raw) : parsed.response
    },
  )

  app.get(
    '/api/executions/:executionId/transcript/stream',
    describeHostRoute({
      tag: 'Runs',
      operationId: 'streamExecutionTranscript',
      summary: 'Follow the transcript of an execution as server-sent events',
      mediaType: 'text/event-stream',
      responses: [200, 400, 404],
    }),
    (c) => {
      const project = projectOf(deps, c)
      if (project instanceof Response) return project
      const parsed = parseValue(ExecutionIdParamsSchema, c.req.param(), 'Invalid path parameters')
      return parsed.ok ? apiStreamExecutionTranscript(project, parsed.data.executionId, c.req.raw) : parsed.response
    },
  )

  return app
}
