// Library surface (for embedding / tests). The CLI is the primary entry point.

export type {
  AgentOpts,
  AgentResult,
  AgentSpec,
  AgentStatus,
  AgentUsage,
  Approval,
  BuiltinProviderId,
  Effort,
  JSONSchema,
  Meta,
  PipelineStage,
  ProviderId,
  RunDefaults,
  Sandbox,
  WorkflowBudget,
  WorkflowGlobals,
  WorkflowWorkspacePolicy,
  WorkspaceStrategy,
} from './dsl/types.ts'
export { BUILTIN_PROVIDER_IDS, isBuiltinProvider } from './dsl/types.ts'
export type { EventListener } from './runtime/event-sink.ts'
export type { AgentState, EventSink, WorkflowEvent, WorkflowEventInput } from './runtime/events.ts'
export type {
  ExecutionPort,
  ExecutionWorkspace,
  ExecutionWorkspaceRelease,
  ExecutionWorkspaceRequest,
  ExecutionWorkspaceSummary,
} from './runtime/execution-port.ts'
export type { ExternalRunContext, RunRoots } from './runtime/journal.ts'
export { dataRoot, Journal, runDir } from './runtime/journal.ts'
export { KEY_VERSION } from './runtime/keys.ts'
export type { RegistryEntry, Tier, WorkflowRegistryRoots } from './runtime/registry.ts'
export { listWorkflows, resolveWorkflowName, WorkflowNotFoundError, workflowDirs } from './runtime/registry.ts'
export type { RunOptions, RunOutcome, RunOverrides } from './runtime/run.ts'
export { runWorkflow } from './runtime/run.ts'
export { parseWorkflow, runInSandbox, WorkflowSyntaxError } from './runtime/sandbox.ts'
export { DefaultWorkerFactory } from './worker/factory.ts'
export type { Worker, WorkerContext, WorkerFactory, WorkerProgress } from './worker/index.ts'
export { AgentError, AgentInterrupted } from './worker/index.ts'
export type { TaskflowWorkerMessage, TaskflowWorkerSpec } from './worker/taskflow-protocol.ts'
export { PORTTA_FLOW_WORKER_PROTOCOL_VERSION } from './worker/taskflow-protocol.ts'
