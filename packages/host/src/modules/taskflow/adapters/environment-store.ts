import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { EnvironmentSchema, EnvironmentServiceSchema } from 'portta-contracts/taskflow'
import type { EnvironmentRecord, EnvironmentService, EnvironmentTrustApproval } from 'portta-core/taskflow'
import { z } from 'portta-core/zod'
import type { EnvironmentTrustStore } from './environment-provider.ts'
import { openDatabase } from './sqlite.ts'

const environmentRecordSchema = EnvironmentSchema.extend({
  providerRef: z.object({ schemaVersion: z.number().int().positive(), value: z.record(z.string(), z.unknown()) }),
})

function parseEnvironmentRecord(value: unknown): EnvironmentRecord {
  return environmentRecordSchema.parse(value)
}

interface EnvironmentRow {
  id: string
  record_json: string
}

interface EnvironmentServiceRow {
  record_json: string
}

export interface EnvironmentStore extends EnvironmentTrustStore {
  save(record: EnvironmentRecord): void
  get(id: string): EnvironmentRecord | null
  list(projectId?: string): EnvironmentRecord[]
  replaceServices(environmentId: string, services: EnvironmentService[]): void
  listServices(environmentId: string): EnvironmentService[]
  getService(environmentId: string, serviceId: string): EnvironmentService | null
  remove(id: string): void
  close(): void
}

export function createEnvironmentStore(path: string): EnvironmentStore {
  mkdirSync(dirname(path), { recursive: true })
  const database = openDatabase(path)
  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      desired_status TEXT NOT NULL,
      observed_status TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS environments_project_idx ON environments(project_id);
    CREATE TABLE IF NOT EXISTS environment_trust (
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      config_ref TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      PRIMARY KEY(project_id, provider, config_ref, config_hash)
    );
    CREATE TABLE IF NOT EXISTS environment_services (
      environment_id TEXT NOT NULL,
      id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(environment_id, id)
    );
    CREATE INDEX IF NOT EXISTS environment_services_environment_idx ON environment_services(environment_id);
  `)

  const replaceServices = database.transaction((environmentId: string, services: EnvironmentService[]): void => {
    database.prepare('DELETE FROM environment_services WHERE environment_id = ?').run(environmentId)
    const insert = database.prepare(
      'INSERT INTO environment_services(environment_id, id, record_json, updated_at) VALUES (?, ?, ?, ?)',
    )
    const now = new Date().toISOString()
    for (const service of services) insert.run(environmentId, service.id, JSON.stringify(service), now)
  })

  return {
    save(record): void {
      database
        .prepare(
          `INSERT INTO environments(id, project_id, workspace_id, provider, desired_status, observed_status, config_hash, record_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET desired_status=excluded.desired_status, observed_status=excluded.observed_status,
             config_hash=excluded.config_hash, record_json=excluded.record_json, updated_at=excluded.updated_at`,
        )
        .run(
          record.id,
          record.scope.projectId,
          record.scope.workspaceId,
          record.provider,
          record.desiredStatus,
          record.status,
          record.configHash,
          JSON.stringify(record),
          record.updatedAt,
        )
    },
    get(id): EnvironmentRecord | null {
      const row = database.prepare('SELECT id, record_json FROM environments WHERE id = ?').get(id) as
        | EnvironmentRow
        | undefined
      return row ? parseEnvironmentRecord(JSON.parse(row.record_json)) : null
    },
    list(projectId): EnvironmentRecord[] {
      const rows = (
        projectId
          ? database
              .prepare('SELECT id, record_json FROM environments WHERE project_id = ? ORDER BY updated_at DESC')
              .all(projectId)
          : database.prepare('SELECT id, record_json FROM environments ORDER BY updated_at DESC').all()
      ) as EnvironmentRow[]
      return rows.map((row) => parseEnvironmentRecord(JSON.parse(row.record_json)))
    },
    replaceServices(environmentId, services): void {
      replaceServices(environmentId, services)
    },
    listServices(environmentId): EnvironmentService[] {
      const rows = database
        .prepare('SELECT record_json FROM environment_services WHERE environment_id = ? ORDER BY id')
        .all(environmentId) as EnvironmentServiceRow[]
      return rows.map((row) => EnvironmentServiceSchema.parse(JSON.parse(row.record_json)))
    },
    getService(environmentId, serviceId): EnvironmentService | null {
      const row = database
        .prepare('SELECT record_json FROM environment_services WHERE environment_id = ? AND id = ?')
        .get(environmentId, serviceId) as EnvironmentServiceRow | undefined
      return row ? EnvironmentServiceSchema.parse(JSON.parse(row.record_json)) : null
    },
    remove(id): void {
      database.prepare('DELETE FROM environment_services WHERE environment_id = ?').run(id)
      database.prepare('DELETE FROM environments WHERE id = ?').run(id)
    },
    isTrusted(projectId, configRef, configHash): boolean {
      return (
        database
          .prepare('SELECT 1 FROM environment_trust WHERE project_id = ? AND config_ref = ? AND config_hash = ?')
          .get(projectId, configRef, configHash) !== undefined
      )
    },
    trust(projectId, configRef, configHash): void {
      const approval: EnvironmentTrustApproval = {
        projectId,
        provider: 'devcontainer',
        configRef,
        configHash,
        approvedAt: new Date().toISOString(),
      }
      database
        .prepare(
          'INSERT OR REPLACE INTO environment_trust(project_id, provider, config_ref, config_hash, approved_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(approval.projectId, approval.provider, approval.configRef, approval.configHash, approval.approvedAt)
    },
    close(): void {
      database.close()
    },
  }
}
