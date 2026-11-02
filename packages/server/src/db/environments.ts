// What this host has been observed running: one row per Compose project.
//
// An Environment is identity plus a cache of where it was last seen. It is
// never deleted because a container vanished; only an explicit removal forgets
// it (ADR 0013, ADR 0031).

import { and, count, desc, eq, sql } from 'drizzle-orm'
import { z } from 'portta-core/zod'
import { type Db, environmentSettings, environments, projectEnvironments, serviceSettings } from 'portta-db'

export interface EnvironmentRecord {
  id: string
  composeProject: string
  workingDir: string | null
  /** The Compose files as the daemon last recorded them; empty when never observed. */
  configFiles: string[]
  firstSeenAt: Date
  lastSeenAt: Date
  updatedAt: Date
}

export interface SeenEnvironment {
  composeProject: string
  workingDir?: string | null
  /** Only a non-empty list overwrites: a stale row keeps its last known paths. */
  configFiles?: string[]
}

export interface EnvironmentRecordCounts {
  overrides: number
  projectLinks: number
}

const SeenEnvironmentSchema = z
  .object({
    composeProject: z.string().min(1).max(255),
    workingDir: z.string().min(1).nullable().optional(),
    configFiles: z.array(z.string().min(1)).optional(),
  })
  .strict()

/** Milliseconds from SQLite's own clock, matching what the schema defaults to. */
const NOW = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`

type Row = typeof environments.$inferSelect

function toRecord(row: Row): EnvironmentRecord {
  return { ...row, id: String(row.id) }
}

export class EnvironmentsRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  /**
   * Seen again. `COALESCE` on each column is what makes a partial observation
   * safe: a snapshot that could not read the working directory must not erase
   * the one the last snapshot did read.
   */
  async upsertSeen(environment: SeenEnvironment): Promise<EnvironmentRecord> {
    const input = SeenEnvironmentSchema.parse(environment)
    const configFiles = input.configFiles ?? []
    const [row] = await this.db
      .insert(environments)
      .values({
        composeProject: input.composeProject,
        workingDir: input.workingDir ?? null,
        configFiles,
      })
      .onConflictDoUpdate({
        target: environments.composeProject,
        set: {
          workingDir: sql`coalesce(excluded.working_dir, ${environments.workingDir})`,
          // The list is JSON text in SQLite, so "did this snapshot see any
          // files" is a length check on the document rather than `cardinality`.
          // `'[]'` and `''` both mean it saw none.
          configFiles: sql`case when json_array_length(coalesce(excluded.config_files, '[]')) > 0 then excluded.config_files else ${environments.configFiles} end`,
          lastSeenAt: NOW,
          updatedAt: NOW,
        },
      })
      .returning()
    if (row === undefined) throw new Error(`database did not return environment ${input.composeProject}`)
    return toRecord(row)
  }

  async list(): Promise<EnvironmentRecord[]> {
    const rows = await this.db
      .select()
      .from(environments)
      .orderBy(desc(environments.lastSeenAt), environments.composeProject)
    return rows.map(toRecord)
  }

  async find(composeProject: string): Promise<EnvironmentRecord | null> {
    const [row] = await this.db.select().from(environments).where(eq(environments.composeProject, composeProject))
    return row ? toRecord(row) : null
  }

  /**
   * What Portta itself stored about an environment. Used by removal preview and
   * by `forget`. Nothing here talks to Docker.
   */
  async recordCounts(composeProject: string): Promise<EnvironmentRecordCounts> {
    const environment = await this.find(composeProject)
    if (!environment) return { overrides: 0, projectLinks: 0 }
    const id = Number(environment.id)
    const [settings, services, projects] = await Promise.all([
      this.db.select({ n: count() }).from(environmentSettings).where(eq(environmentSettings.environmentId, id)),
      this.db.select({ n: count() }).from(serviceSettings).where(eq(serviceSettings.environmentId, id)),
      this.db.select({ n: count() }).from(projectEnvironments).where(eq(projectEnvironments.environmentId, id)),
    ])
    return {
      overrides: (settings[0]?.n ?? 0) + (services[0]?.n ?? 0),
      projectLinks: projects[0]?.n ?? 0,
    }
  }

  /** Drops the row. Settings and project links cascade. */
  async forget(composeProject: string): Promise<EnvironmentRecordCounts> {
    const counts = await this.recordCounts(composeProject)
    await this.db.delete(environments).where(eq(environments.composeProject, composeProject))
    return counts
  }

  /** The id of an environment by name, for the repositories that key on it. */
  async idOf(composeProject: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: environments.id })
      .from(environments)
      .where(and(eq(environments.composeProject, composeProject)))
    return row?.id ?? null
  }
}
