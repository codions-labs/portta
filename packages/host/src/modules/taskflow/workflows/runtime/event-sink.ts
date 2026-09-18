// FileEventSink: appends WorkflowEvents to runs/<runId>/events.jsonl (the observability log the
// terminal renderer and the viewer server both read). Stamps each event with `t` (ms).

import { join } from 'node:path'
import type { EventSink, WorkflowEvent, WorkflowEventInput } from './events.ts'
import { type RunRoots, runDir } from './journal.ts'
import { JsonlWriter } from './jsonl-writer.ts'

export type EventListener = (event: WorkflowEvent) => void

export class FileEventSink implements EventSink {
  private readonly writer: JsonlWriter
  private readonly listeners: EventListener[]
  private readonly clock: () => number

  constructor(runId: string, opts: { listeners?: EventListener[]; clock?: () => number; roots?: RunRoots } = {}) {
    // A disk error on the observability log must not crash the run — degrade to best-effort.
    this.writer = new JsonlWriter(join(runDir(runId, opts.roots), 'events.jsonl'), { flags: 'a' })
    this.listeners = opts.listeners ?? []
    // Wall-clock for the observability log is fine (it is NOT part of resume determinism).
    this.clock = opts.clock ?? (() => globalThis.Date.now())
  }

  emit(event: WorkflowEventInput): void {
    const full = { ...event, t: this.clock() } as WorkflowEvent
    this.writer.writeRecord(full)
    // A throwing listener (e.g. EPIPE on a stderr renderer) must not fail the agent or skip the rest.
    for (const l of this.listeners) {
      try {
        l(full)
      } catch {
        // best-effort: one bad listener doesn't poison the others or the run
      }
    }
  }

  close(): Promise<void> {
    return this.writer.close()
  }
}
