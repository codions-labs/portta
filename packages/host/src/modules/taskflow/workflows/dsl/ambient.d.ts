// Ambient declarations of the globals injected into a workflow file (the file runs in a sandbox
// with no imports). Editor-facing only: nothing at runtime reads this file, and the CLI does not
// ship it.
//
// This file is SELF-CONTAINED on purpose and imports nothing. The option types below are inlined
// copies of the ones in ./types.ts; keep them in sync
// (tests/modules/taskflow/workflows/ambient-types.test.ts asserts the union members).

declare global {
  // The builtins, plus any id the project declares under `providers:` (validated at runtime).
  type TaskflowProviderId = 'codex' | 'claude-code' | 'opencode' | 'pi' | (string & {})

  type TaskflowSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

  type TaskflowEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

  type TaskflowApproval = 'never' | 'on-request'

  type TaskflowWorkspaceStrategy = 'isolated_worktree' | 'new_branch' | 'current_branch'

  interface TaskflowWorkflowWorkspacePolicy {
    default: TaskflowWorkspaceStrategy
    allowed?: TaskflowWorkspaceStrategy[]
    mutatesRepository?: boolean
    reason?: string
  }

  type TaskflowJSONSchema = Record<string, unknown>

  /** Options an author passes to `agent()`. All optional; defaults come from meta/config/CLI. */
  interface TaskflowAgentBaseOpts {
    label?: string
    phase?: string
    effort?: TaskflowEffort
    cwd?: string
    sandbox?: TaskflowSandbox
    approval?: TaskflowApproval
    instructions?: string
    schema?: TaskflowJSONSchema
    worktree?: boolean | string
    /** Pin a stable resume cache key; otherwise the chained key is used. */
    key?: string
    /** Hard cap on agent turns (provider-enforced where supported). */
    maxTurns?: number
  }

  /** provider and model travel together (both-or-neither): a lone provider would inherit a model
   *  meant for a different provider from the run defaults. Set both, or omit both. */
  type TaskflowAgentOpts = TaskflowAgentBaseOpts &
    ({ provider: TaskflowProviderId; model: string } | { provider?: never; model?: never })

  type TaskflowPipelineStage = (prev: unknown, item: unknown, index: number) => unknown | Promise<unknown>

  /** Run one agent turn (Codex or Claude Code, per opts.provider). Returns final text, or a
   *  validated object when opts.schema is set. */
  function agent<T = string>(prompt: string, opts?: TaskflowAgentOpts): Promise<T>

  /** Run thunks concurrently (under the cap) and await all. Wrap each call: () => agent(...). */
  function parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]>

  /** Stream each item through all stages independently (no barrier). Stages get (prev, item, i). */
  function pipeline(items: unknown[], ...stages: TaskflowPipelineStage[]): Promise<unknown[]>

  /** Open a named progress group; subsequent agent() calls render under it. */
  function phase(title: string): void

  /** Emit a narrator line to the progress UI. */
  function log(msg: string): void

  /** Journal-seeded clock (use instead of Date.now(), which throws). */
  function now(): number

  /** Journal-seeded RNG (use instead of Math.random(), which throws). */
  function random(): number

  /** Token budget for the run: `{ total: number|null, spent(): number, remaining(): number }`. */
  const budget: { total: number | null; spent(): number; remaining(): number }

  /** The CLI-supplied input (--args '<json>'); undefined if not passed. */
  const args: unknown
}

export {}
