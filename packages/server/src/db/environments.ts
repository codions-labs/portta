// What this host has been observed running: one row per Compose project.
//
// An Environment is identity plus a cache of where it was last seen. It is
// never deleted because a container vanished; only an explicit removal forgets
// it (ADR 0013, ADR 0031).

import { and, count, desc, eq, sql } from 'drizzle-orm'
import { parseIssueRef } from 'portta-core'
import {
  type Db,
  environmentIssues,
  environmentSettings,
  environments,
  projectEnvironments,
  serviceSettings,
} from 'portta-db'
import { z } from 'zod'
import type { IssueLinkSource, StoredIssueLink } from '../services/issues/environments.ts'

export interface EnvironmentRecord {
  id: string
  composeProject: string
  workingDir: string | null
  /** The Compose files as the daemon last recorded them; empty when never observed. */
  configFiles: string[]
  repoUrl: string | null
  repoSubpath: string | null
  firstSeenAt: Date
  lastSeenAt: Date
  updatedAt: Date
}

export interface SeenEnvironment {
  composeProject: string
  workingDir?: string | null
  /** Only a non-empty list overwrites: a stale row keeps its last known paths. */
  configFiles?: string[]
  repoUrl?: string | null
  repoSubpath?: string | null
}

export interface EnvironmentRecordCounts {
  overrides: number
  projectLinks: number
  issueLinks: number
}

const SeenEnvironmentSchema = z
  .object({
    composeProject: z.string().min(1).max(255),
    workingDir: z.string().min(1).nullable().optional(),
    configFiles: z.array(z.string().min(1)).optional(),
    repoUrl: z.string().min(1).nullable().optional(),
    repoSubpath: z.string().min(1).nullable().optional(),
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
        repoUrl: input.repoUrl ?? null,
        repoSubpath: input.repoSubpath ?? null,
      })
      .onConflictDoUpdate({
        target: environments.composeProject,
        set: {
          workingDir: sql`coalesce(excluded.working_dir, ${environments.workingDir})`,
          // The list is JSON text in SQLite, so "did this snapshot see any
          // files" is a length check on the document rather than `cardinality`.
          // `'[]'` and `''` both mean it saw none.
          configFiles: sql`case when json_array_length(coalesce(excluded.config_files, '[]')) > 0 then excluded.config_files else ${environments.configFiles} end`,
          repoUrl: sql`coalesce(excluded.repo_url, ${environments.repoUrl})`,
          repoSubpath: sql`coalesce(excluded.repo_subpath, ${environments.repoSubpath})`,
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
   * by `forget`. Nothing here talks to GitHub or to Docker.
   */
  async recordCounts(composeProject: string): Promise<EnvironmentRecordCounts> {
    const environment = await this.find(composeProject)
    if (!environment) return { overrides: 0, projectLinks: 0, issueLinks: 0 }
    const id = Number(environment.id)
    const [settings, services, projects, issues] = await Promise.all([
      this.db.select({ n: count() }).from(environmentSettings).where(eq(environmentSettings.environmentId, id)),
      this.db.select({ n: count() }).from(serviceSettings).where(eq(serviceSettings.environmentId, id)),
      this.db.select({ n: count() }).from(projectEnvironments).where(eq(projectEnvironments.environmentId, id)),
      this.db.select({ n: count() }).from(environmentIssues).where(eq(environmentIssues.environmentId, id)),
    ])
    return {
      overrides: (settings[0]?.n ?? 0) + (services[0]?.n ?? 0),
      projectLinks: projects[0]?.n ?? 0,
      issueLinks: issues[0]?.n ?? 0,
    }
  }

  /**
   * Every stored environment-to-issue link, joined to the environment's name.
   *
   * The resolver above works in Compose project names because that is what a
   * Docker snapshot has; the row keys on the environment id because that is
   * what cascades. This is the one place the two meet.
   */
  async listIssueLinks(): Promise<StoredIssueLink[]> {
    const rows = await this.db
      .select({
        composeProject: environments.composeProject,
        issueRef: environmentIssues.issueRef,
        source: environmentIssues.source,
        branch: environmentIssues.branch,
      })
      .from(environmentIssues)
      .innerJoin(environments, eq(environments.id, environmentIssues.environmentId))
    return rows.map((row) => ({ ...row, source: row.source as IssueLinkSource }))
  }

  /**
   * Linking by hand, which outranks every inference.
   *
   * The ref is validated here rather than trusted: it arrives from a request
   * body, and a ref nothing can parse would be a row that resolves to an issue
   * that does not exist, forever.
   */
  async linkIssue(composeProject: string, issueRef: string, branch: string | null = null): Promise<void> {
    if (!parseIssueRef(issueRef)) throw new Error(`not an issue reference: ${issueRef}`)
    const id = await this.idOf(composeProject)
    if (id === null) throw new Error(`no such environment: ${composeProject}`)
    await this.db
      .insert(environmentIssues)
      .values({ environmentId: id, issueRef, source: 'manual', branch })
      .onConflictDoUpdate({
        target: environmentIssues.environmentId,
        set: { issueRef, source: 'manual', branch, linkedAt: NOW },
      })
  }

  /** Unlinking falls back to inference, which is why this removes rather than nulls. */
  async unlinkIssue(composeProject: string): Promise<void> {
    const id = await this.idOf(composeProject)
    if (id === null) return
    await this.db.delete(environmentIssues).where(eq(environmentIssues.environmentId, id))
  }

  /** Drops the row. Settings, project links and issue links cascade. */
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
