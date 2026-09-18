import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveWorkerBins } from '../lib/host-tools.ts'
import {
  DefaultWorkerFactory,
  type ExecutionPort,
  PORTTA_FLOW_WORKER_PROTOCOL_VERSION,
  type RunOutcome,
  runWorkflow,
  type TaskflowWorkerMessage,
  type TaskflowWorkerSpec,
  type WorkerFactory,
} from '../workflows/index.ts'

export type WorkflowWorkerTerminal =
  | { type: 'completed'; cursor: number; result: unknown }
  | { type: 'failed' | 'crash'; cursor: number; error: string }

export interface WorkflowRunSpec {
  runId: string
  engineRunId: string
  cursor?: number
  spec: TaskflowWorkerSpec
}

export interface WorkflowRunControl {
  onMessage?: (message: TaskflowWorkerMessage) => void
}

export interface WorkflowRunHandle {
  readonly pid: number
  readonly cursor: number
  readonly cancelAcknowledged: boolean
  readonly done: Promise<WorkflowWorkerTerminal>
  cancel(): Promise<void>
  detach?(): Promise<void>
}

export interface WorkflowRunInspection {
  engineRunId: string
  pid: number
  cursor: number
  active: boolean
}

export interface WorkflowRunner {
  run(spec: WorkflowRunSpec, control?: WorkflowRunControl): WorkflowRunHandle
  inspect(engineRunId: string): WorkflowRunInspection | null
}

export interface NodeWorkflowRunnerDependencies {
  runWorkflow?: typeof runWorkflow
  createExecutionPort?: (spec: WorkflowRunSpec) => ExecutionPort | undefined
  createWorkerFactory?: (spec: WorkflowRunSpec) => WorkerFactory | undefined
  /** Provider ids the factory for this spec can serve; omitted means the builtins. */
  knownProviders?: (spec: WorkflowRunSpec) => readonly string[]
}

type WorkerMessageBody = TaskflowWorkerMessage extends infer Message
  ? Message extends TaskflowWorkerMessage
    ? Omit<Message, 'version' | 'runId' | 'engineRunId'>
    : never
  : never

function envelope(spec: WorkflowRunSpec, message: WorkerMessageBody): TaskflowWorkerMessage {
  return {
    ...message,
    version: PORTTA_FLOW_WORKER_PROTOCOL_VERSION,
    runId: spec.runId,
    engineRunId: spec.engineRunId,
  } as TaskflowWorkerMessage
}

function terminalFromOutcome(outcome: RunOutcome, cursor: number): WorkflowWorkerTerminal {
  if (outcome.status === 'completed') {
    return { type: 'completed', cursor, result: outcome.result ?? null }
  }
  return { type: 'failed', cursor, error: outcome.error ?? `workflow ${outcome.status}` }
}

export class NodeWorkflowRunner implements WorkflowRunner {
  private readonly active = new Map<string, WorkflowRunHandle>()
  private readonly invoke: typeof runWorkflow
  private readonly createExecutionPort: NodeWorkflowRunnerDependencies['createExecutionPort']
  private readonly createWorkerFactory: NodeWorkflowRunnerDependencies['createWorkerFactory']
  private readonly knownProviders: NodeWorkflowRunnerDependencies['knownProviders']

  constructor(dependencies: NodeWorkflowRunnerDependencies = {}) {
    this.invoke = dependencies.runWorkflow ?? runWorkflow
    this.createExecutionPort = dependencies.createExecutionPort
    this.createWorkerFactory = dependencies.createWorkerFactory
    this.knownProviders = dependencies.knownProviders
  }

  run(spec: WorkflowRunSpec, control: WorkflowRunControl = {}): WorkflowRunHandle {
    const emit = control.onMessage ?? ((): void => {})
    const abort = new AbortController()
    let cursor = spec.cursor ?? 0
    let cancelAcknowledged = false
    const pid = process.pid
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const done = (async (): Promise<WorkflowWorkerTerminal> => {
      const runDirectory = join(spec.spec.dataRoot, 'runs', spec.engineRunId)
      await mkdir(runDirectory, { recursive: true })
      const snapshotPath = join(runDirectory, 'workflow.js')
      await writeFile(snapshotPath, spec.spec.source, 'utf8')
      emit(envelope(spec, { type: 'started', pid }))
      heartbeat = setInterval((): void => {
        emit(envelope(spec, { type: 'heartbeat', cursor }))
      }, 1_000)
      heartbeat.unref()
      try {
        const outcome = await this.invoke({
          file: snapshotPath,
          runId: spec.engineRunId,
          resumeRunId: spec.spec.resume ? spec.engineRunId : undefined,
          args: spec.spec.args,
          fake: spec.spec.fake,
          quiet: true,
          mode: 'taskflow',
          roots: { dataRoot: spec.spec.dataRoot, workspaceRoot: spec.spec.cwd },
          externalContext: spec.spec.externalContext,
          factory:
            this.createWorkerFactory?.(spec) ??
            new DefaultWorkerFactory(spec.spec.fake ? { fake: true } : { fake: false, ...resolveWorkerBins() }),
          knownProviders: this.knownProviders?.(spec),
          executionPort: this.createExecutionPort?.(spec),
          signal: abort.signal,
          onEvent: (event): void => {
            cursor += 1
            emit(envelope(spec, { type: 'event', cursor, event }))
          },
        })
        const terminal = terminalFromOutcome(outcome, cursor)
        if (terminal.type === 'completed') {
          emit(envelope(spec, { type: 'completed', cursor: terminal.cursor, result: terminal.result }))
        } else {
          emit(envelope(spec, { type: 'failed', cursor: terminal.cursor, error: terminal.error }))
        }
        return terminal
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'workflow runner crashed'
        emit(envelope(spec, { type: 'crash', cursor, error: message }))
        return { type: 'crash', cursor, error: message }
      } finally {
        if (heartbeat) clearInterval(heartbeat)
      }
    })()

    const handle: WorkflowRunHandle = {
      pid,
      get cursor(): number {
        return cursor
      },
      get cancelAcknowledged(): boolean {
        return cancelAcknowledged
      },
      done,
      cancel: async (): Promise<void> => {
        abort.abort()
        cancelAcknowledged = true
        emit(envelope(spec, { type: 'cancel-ack' }))
        await done
      },
      detach: async (): Promise<void> => {
        abort.abort('taskflow-detach')
        await done
      },
    }
    this.active.set(spec.engineRunId, handle)
    void done.finally((): void => {
      this.active.delete(spec.engineRunId)
    })
    return handle
  }

  inspect(engineRunId: string): WorkflowRunInspection | null {
    const handle = this.active.get(engineRunId)
    return handle ? { engineRunId, pid: handle.pid, cursor: handle.cursor, active: true } : null
  }
}
