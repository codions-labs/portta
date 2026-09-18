// What happened in the development flow, as a closed vocabulary.
//
// Activity is not a log. A log answers "what is the process printing"; an
// activity event answers "what happened to this project": an issue was opened,
// a session started, an environment was rebuilt, a commit landed. The kinds are
// listed here so the panel, the CLI and an agent name them the same way.
//
// The `issue.*` kinds record what Portta did *to* an external issue, never what
// happened in GitHub or Linear on their own: Portta has no webhook and no
// mirror, so an issue somebody closed in a browser leaves no row here.

import { extendVocabulary, MODULES, type ModuleActivityKind, moduleActivityKinds } from './modules/index.ts'

const BASE_ACTIVITY_KINDS = [
  'issue.created',
  'issue.updated',
  'issue.state',
  'issue.assigned',
  'issue.comment',
  'issue.linked',
  'session.started',
  'session.ended',
  'session.abandoned',
  'repository.added',
  'repository.removed',
  'repository.commit',
  'repository.branch',
  'environment.started',
  'environment.stopped',
  'environment.restarted',
  'environment.rebuilt',
  'environment.removed',
  'environment.forgotten',
  'environment.adopted',
  'service.unhealthy',
  'service.recovered',
  'project.created',
  'project.updated',
  'project.deleted',
] as const
export type ActivityKind = (typeof BASE_ACTIVITY_KINDS)[number] | ModuleActivityKind<typeof MODULES>
/** The base kinds, then what the registered modules record. A module never redefines a base kind. */
export const ACTIVITY_KINDS: readonly ActivityKind[] = extendVocabulary<ActivityKind>(
  BASE_ACTIVITY_KINDS,
  moduleActivityKinds(MODULES),
  'activity kind',
)

export const ACTIVITY_SOURCES = ['web', 'cli', 'mcp', 'api', 'github', 'system'] as const
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]

export function isActivityKind(value: string): value is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(value)
}

export const SESSION_STATUSES = ['active', 'ended', 'abandoned'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

/** Retention: what "recent" means for the timeline. Pruned in code, never a cron. */
export const ACTIVITY_KEEP_DAYS = 90
export const ACTIVITY_KEEP_PER_PROJECT = 5000

/** A session with no heartbeat for this long is abandoned, not active. */
export const SESSION_ABANDON_AFTER_SECONDS = 6 * 60 * 60
