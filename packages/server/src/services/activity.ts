// Recording what happened, without ever failing the request that did it.

import type { ActivityKind } from 'portta-core'
import type { ActivityInput } from '../db/activity.ts'
import type { Database } from '../db/index.ts'
import type { LiveHub } from '../realtime/hub.ts'

export interface ActivityDeps {
  db: Database | null
  hub: LiveHub
}

export interface ActivityRecord extends Omit<ActivityInput, 'kind'> {
  kind: ActivityKind
  /** Project slug, carried on the live event so the UI can invalidate one project. */
  project?: string | null
}

/**
 * Append one event and tell the browser. A failure here is written to stderr
 * and swallowed: the task moved, the environment stopped; the history missing
 * one line is the smaller problem.
 */
export async function recordActivity(deps: ActivityDeps, input: ActivityRecord): Promise<void> {
  const db = deps.db
  if (db === null || !db.status().available) return
  try {
    const { project, ...record } = input
    const row = await db.activity.append(record)
    deps.hub.publish({
      kind: 'activity',
      action: input.kind,
      id: row.id,
      name: input.summary,
      project: project ?? null,
      ownership: null,
      at: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    process.stderr.write(
      `activity not recorded (${input.kind}): ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
}
