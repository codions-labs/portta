// Activity and sessions, as the API returns them: ids resolved to the names a
// reader recognises, timestamps as seconds.

import type { ActivityEvent, Session } from 'portta-contracts'
import type { ActivityRow } from '../db/activity.ts'
import type { Database } from '../db/index.ts'
import type { SessionRow } from '../db/work-sessions.ts'

function seconds(date: Date | null): number | null {
  return date ? Math.floor(date.getTime() / 1000) : null
}

export interface NameContext {
  slugById: Map<string, string>
  repositoryNameById: Map<string, string>
  environmentNameById: Map<string, string>
}

export async function loadNames(db: Database): Promise<NameContext> {
  const [projects, repositories, environments] = await Promise.all([
    db.projects.list(),
    db.repositories.list(),
    db.environments.list(),
  ])
  return {
    slugById: new Map(projects.map((project) => [project.id, project.slug])),
    repositoryNameById: new Map(repositories.map((repository) => [repository.id, repository.name])),
    environmentNameById: new Map(environments.map((environment) => [environment.id, environment.composeProject])),
  }
}

export function activityView(names: NameContext, row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    at: seconds(row.at) ?? 0,
    kind: row.kind,
    actor: row.actor,
    actorKind: row.actorKind,
    source: row.source,
    summary: row.summary,
    project: row.projectId ? (names.slugById.get(row.projectId) ?? null) : null,
    issueRef: row.issueRef,
    repositoryId: row.repositoryId,
    repositoryName: row.repositoryId ? (names.repositoryNameById.get(row.repositoryId) ?? null) : null,
    environment: row.environmentId ? (names.environmentNameById.get(row.environmentId) ?? null) : null,
    sessionId: row.sessionId,
    data: row.data ?? {},
  }
}

export function sessionView(names: NameContext, row: SessionRow): Session {
  return {
    id: row.id,
    project: names.slugById.get(row.projectId) ?? row.projectId,
    issueRef: row.issueRef,
    repository: row.repositoryId
      ? { id: row.repositoryId, name: names.repositoryNameById.get(row.repositoryId) ?? row.repositoryId }
      : null,
    environment: row.environmentId ? (names.environmentNameById.get(row.environmentId) ?? null) : null,
    actor: row.actor,
    actorKind: row.actorKind,
    agent: row.agent,
    status: row.status,
    startedAt: seconds(row.startedAt) ?? 0,
    lastActivityAt: seconds(row.lastActivityAt) ?? 0,
    endedAt: seconds(row.endedAt),
    summary: row.summary,
    headBefore: row.headBefore,
    headAfter: row.headAfter,
    commits: Array.isArray(row.commits) ? row.commits : [],
  }
}
