// The product the operator recognises. A decision, so nothing on the snapshot
// path writes here and nothing here disappears when nothing is running.

import { asc, eq, inArray } from 'drizzle-orm'
import { parseRelativeProjectPath, TASK_PROVIDERS, type TaskProvider } from 'portta-core'
import { type Db, environments, projectEnvironments, projects } from 'portta-db'
import { z } from 'zod'

export interface ProjectRecord {
  id: string
  slug: string
  name: string
  description: string | null
  archived: boolean
  /** Null means "not chosen": the panel derives GitHub from the repository's remote. */
  taskProvider: TaskProvider | null
  /** The Linear team, when the provider is Linear. Uppercase, such as `ENG`. */
  linearTeam: string | null
  /** First-level directory under Projects Home. Null when unmanaged / not yet placed. */
  relativePath: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ProjectEnvironmentRow {
  projectId: string
  composeProject: string
  source: string
}

const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be a lowercase slug')

/**
 * The first-level directory under Projects Home, never an absolute path and
 * never the identity (ADR 0031). Validated the same way the core does.
 */
const RelativePath = z.string().transform((value, ctx) => {
  try {
    return parseRelativeProjectPath(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'invalid relative path' })
    return z.NEVER
  }
})

const CreateProject = z
  .object({
    slug: Slug,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().default(null),
    relativePath: RelativePath.nullable().default(null),
    taskProvider: z.enum(TASK_PROVIDERS).nullable().default(null),
    linearTeam: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'a Linear team key is up to ten uppercase letters or digits')
      .nullable()
      .default(null),
  })
  .strict()

const UpdateProject = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    relativePath: RelativePath.nullable().optional(),
    taskProvider: z.enum(TASK_PROVIDERS).nullable().optional(),
    linearTeam: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'a Linear team key is up to ten uppercase letters or digits')
      .nullable()
      .optional(),
  })
  .strict()

type Row = typeof projects.$inferSelect

function toRecord(row: Row): ProjectRecord {
  return { ...row, id: String(row.id) }
}

export class ProjectsRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async create(input: unknown): Promise<ProjectRecord> {
    const parsed = CreateProject.parse(input)
    const [row] = await this.db.insert(projects).values(parsed).returning()
    if (row === undefined) throw new Error(`database did not return project ${parsed.slug}`)
    return toRecord(row)
  }

  /**
   * Every column is optional, and `description` and `relativePath` are
   * deliberately three-valued: an absent key leaves the column alone, `null`
   * clears it, and a value sets it, so "no change" and "clear this" stay
   * distinguishable.
   */
  async update(slug: string, patch: unknown): Promise<ProjectRecord | null> {
    const parsed = UpdateProject.parse(patch)
    const changes: Partial<Row> = { updatedAt: new Date() }
    if (parsed.name !== undefined) changes.name = parsed.name
    if (Object.hasOwn(parsed, 'description')) changes.description = parsed.description ?? null
    if (parsed.archived !== undefined) changes.archived = parsed.archived
    if (Object.hasOwn(parsed, 'taskProvider')) changes.taskProvider = parsed.taskProvider ?? null
    if (Object.hasOwn(parsed, 'linearTeam')) changes.linearTeam = parsed.linearTeam ?? null
    if (Object.hasOwn(parsed, 'relativePath')) changes.relativePath = parsed.relativePath ?? null
    const [row] = await this.db.update(projects).set(changes).where(eq(projects.slug, slug)).returning()
    return row ? toRecord(row) : null
  }

  async list(): Promise<ProjectRecord[]> {
    const rows = await this.db.select().from(projects).orderBy(asc(projects.archived), asc(projects.name))
    return rows.map(toRecord)
  }

  async find(slug: string): Promise<ProjectRecord | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.slug, slug))
    return row ? toRecord(row) : null
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, Number(id)))
    return row ? toRecord(row) : null
  }

  /** Removes the grouping only. No container, volume or repository is touched. */
  async remove(slug: string): Promise<boolean> {
    const rows = await this.db.delete(projects).where(eq(projects.slug, slug)).returning({ id: projects.id })
    return rows.length > 0
  }

  async listEnvironments(): Promise<ProjectEnvironmentRow[]> {
    const rows = await this.db
      .select({
        projectId: projectEnvironments.projectId,
        composeProject: environments.composeProject,
        source: projectEnvironments.source,
      })
      .from(projectEnvironments)
      .innerJoin(environments, eq(environments.id, projectEnvironments.environmentId))
    return rows.map((row) => ({ ...row, projectId: String(row.projectId) }))
  }

  /**
   * Replace this Project's adoptions. An environment belongs to at most one
   * Project, so claiming one another Project holds moves it rather than failing.
   */
  async setEnvironments(projectId: string, composeProjects: unknown): Promise<void> {
    const names = z.array(z.string().min(1).max(255)).max(128).parse(composeProjects)
    const id = Number(projectId)
    // Synchronous inside the transaction, and deliberately so: better-sqlite3
    // transactions run the callback to completion and commit, so an `await`
    // inside one resolves *after* the commit and the statements that follow it
    // land outside the transaction they were supposed to be in. The driver
    // refuses a callback that returns a promise rather than letting that
    // happen, which is what makes this a compile-and-crash rather than a
    // silent loss of atomicity.
    this.db.transaction((tx) => {
      tx.delete(projectEnvironments).where(eq(projectEnvironments.projectId, id)).run()
      if (names.length === 0) return
      // A name nothing has been seen running under is skipped, not an error:
      // the operator may be adopting an environment before it first starts.
      const known = tx
        .select({ id: environments.id })
        .from(environments)
        .where(inArray(environments.composeProject, names))
        .all()
      for (const environment of known) {
        tx.insert(projectEnvironments)
          .values({ projectId: id, environmentId: environment.id, source: 'manual' })
          .onConflictDoUpdate({
            target: projectEnvironments.environmentId,
            set: { projectId: id, source: 'manual' },
          })
          .run()
      }
    })
  }
}
