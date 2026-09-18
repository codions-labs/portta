import { RunEventSchema, TranscriptEntrySchema } from 'portta-contracts/taskflow'
import type {
  CreateRunRequest,
  ExecutionTranscriptResponse,
  RunDetailResponse,
  RunEvent,
  RunEventsResponse,
  RunListResponse,
  RunWorkspaceContext,
  TranscriptEntry,
  WorkflowListResponse,
} from '../types.ts'
import type { TaskflowClient } from './client.ts'

/** A server-sent event stream whose every message is one parsed value. */
function follow<T>(
  url: string,
  parse: (value: unknown) => T,
  onValue: (value: T) => void,
  onError: () => void,
): () => void {
  const source = new EventSource(url)
  source.onmessage = (message: MessageEvent<string>): void => {
    try {
      onValue(parse(JSON.parse(message.data)))
    } catch {
      onError()
    }
  }
  source.onerror = (): void => onError()
  return () => source.close()
}

export function runApi({ contract, base, prefix }: TaskflowClient) {
  // A Run route names its Project by id, and a Taskflow Project's id is its prefix.
  const project = { projectId: prefix }
  return {
    fetchWorkflows: (): Promise<WorkflowListResponse> => contract.fetchProjectWorkflows({ params: project }),
    fetchRunWorkspaceContext: (): Promise<RunWorkspaceContext> =>
      contract.fetchRunWorkspaceContext({ params: project }),
    fetchRuns: (): Promise<RunListResponse> => contract.fetchProjectRuns({ params: project }),
    createRun: (request: CreateRunRequest): Promise<RunDetailResponse> =>
      contract.createProjectRun({ params: project, body: request }),
    fetchRun: (runId: string): Promise<RunDetailResponse> => contract.fetchRun({ params: { runId } }),
    fetchRunEvents: (runId: string, after?: number): Promise<RunEventsResponse> =>
      contract.fetchRunEvents({ params: { runId }, query: after === undefined ? {} : { after } }),
    cancelRun: (runId: string): Promise<RunDetailResponse> =>
      contract.cancelRun({ params: { runId }, body: { idempotencyKey: crypto.randomUUID() } }),
    resumeRun: (runId: string): Promise<RunDetailResponse> =>
      contract.resumeRun({ params: { runId }, body: { idempotencyKey: crypto.randomUUID() } }),
    respondRunPermission: (runId: string, requestId: string, optionId: string | null): Promise<RunDetailResponse> =>
      contract.respondRunPermission({ params: { runId }, body: { requestId, optionId } }),
    fetchExecutionTranscript: (executionId: string, after?: number): Promise<ExecutionTranscriptResponse> =>
      contract.fetchExecutionTranscript({ params: { executionId }, query: after === undefined ? {} : { after } }),

    connectRunEventStream(
      runId: string,
      after: number | null,
      callbacks: { onEvent: (event: RunEvent) => void; onError: () => void },
    ): () => void {
      const query = after === null ? '' : `?after=${after}`
      return follow(
        `${base}/api/runs/${encodeURIComponent(runId)}/stream${query}`,
        (value) => RunEventSchema.parse(value),
        callbacks.onEvent,
        callbacks.onError,
      )
    },

    connectExecutionTranscriptStream(
      executionId: string,
      after: number,
      callbacks: { onEntry: (entry: TranscriptEntry) => void; onError: () => void },
    ): () => void {
      return follow(
        `${base}/api/executions/${encodeURIComponent(executionId)}/transcript/stream?after=${after}`,
        (value) => TranscriptEntrySchema.parse(value),
        callbacks.onEntry,
        callbacks.onError,
      )
    },
  }
}
