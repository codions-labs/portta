// An Environment the panel has seen and whose containers are gone.
//
// The snapshot only knows what Docker still holds. The database keeps the
// identity and where the Environment last ran (ADR 0013, ADR 0031), which is
// exactly what `docker compose up` needs when nothing is left to read labels
// from. A remembered Environment is a full `Environment` with no services,
// so every list and page that renders one renders it the same way, with
// `presence` saying which kind it is.

import type { Environment, EnvironmentStartable } from 'portta-contracts'
import { projectOperable } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { EnvironmentRecord } from '../db/environments.ts'
import type { Database } from '../db/index.ts'
import { CONTAINERS_GONE_REASON } from './actions.ts'
import type { Snapshot } from './inventory.ts'
import { runnerOf } from './runner.ts'

function shellSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The exact command that brings a remembered Environment back, for a host without the runner. */
export function composeUpCommand(name: string, workingDir: string, configFiles: readonly string[]): string {
  const files = configFiles.map((file) => `-f ${shellSingle(file)}`).join(' ')
  return `docker compose --project-name ${name} --project-directory ${shellSingle(workingDir)}${files ? ` ${files}` : ''} up -d`
}

function rememberedStartable(
  record: EnvironmentRecord,
  runnerPresent: boolean,
  config: Pick<PanelConfig, 'projectName'>,
): EnvironmentStartable {
  if (record.composeProject === config.projectName) {
    return { ok: false, reason: "this is Portta's own project: start it with portta up", via: null }
  }
  if (!record.workingDir) return { ok: false, reason: CONTAINERS_GONE_REASON, via: 'runner' }
  if (runnerPresent) return { ok: true, reason: null, via: 'runner' }
  return {
    ok: false,
    reason: composeUpCommand(record.composeProject, record.workingDir, record.configFiles ?? []),
    via: 'runner',
  }
}

export function rememberedEnvironment(
  record: EnvironmentRecord,
  runnerPresent: boolean,
  config: Pick<PanelConfig, 'projectName'>,
): Environment {
  return {
    name: record.composeProject,
    presence: 'remembered',
    integrated: false,
    workingDir: record.workingDir ?? null,
    operable: projectOperable(record.workingDir ?? null, record.configFiles ?? []),
    startable: rememberedStartable(record, runnerPresent, config),
    namespace: null,
    group: null,
    repo: null,
    repoUrl: record.repoUrl ?? null,
    gitRoot: record.repoSubpath ?? null,
    services: [],
    serviceCount: 0,
    runningCount: 0,
    completedCount: 0,
    healthyCount: 0,
    unhealthyCount: 0,
    networks: [],
    urls: [],
    scopes: [],
    startedAt: null,
    uptimeSeconds: null,
  }
}

/**
 * Every remembered Environment that is not in the snapshot, newest first.
 * No database, or none reachable, is an empty list: the panel then shows
 * exactly what Docker shows.
 */
export async function rememberedEnvironments(
  db: Database | null,
  snapshot: Snapshot,
  config: Pick<PanelConfig, 'projectName'>,
): Promise<Environment[]> {
  if (db === null || !db.status().available) return []
  const live = new Set(snapshot.environments.map((environment) => environment.name))
  const records = await db.environments.list().catch(() => [] as EnvironmentRecord[])
  const runnerPresent = runnerOf(snapshot) !== null
  return records
    .filter((record) => !live.has(record.composeProject))
    .map((record) => rememberedEnvironment(record, runnerPresent, config))
}

export async function findRememberedEnvironment(
  db: Database | null,
  snapshot: Snapshot,
  config: Pick<PanelConfig, 'projectName'>,
  name: string,
): Promise<Environment | null> {
  if (db === null || !db.status().available) return null
  if (snapshot.environments.some((environment) => environment.name === name)) return null
  const record = await db.environments.find(name).catch(() => null)
  if (!record) return null
  return rememberedEnvironment(record, Boolean(runnerOf(snapshot)), config)
}
