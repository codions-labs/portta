import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { Project, ProjectSummary, TaskProvider } from 'portta-contracts'
import { parseRelativeProjectPath } from 'portta-core'
import { z } from 'portta-core/zod'
import { type Database, requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope, visible } from '../../services/access-control.ts'
import { recordActivity } from '../../services/activity.ts'
import { loadProjectCatalog, type ProjectCatalog, toProject, toProjectSummary } from '../../services/catalog.ts'
import type { Snapshot } from '../../services/inventory.ts'
import { OverrideRefused } from '../../services/overrides.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The Project slug, as created.',
  schema: { type: 'string' as const },
}

const ProjectsResponse = z
  .object({ projects: z.array(ProjectSummary) })
  .strict()
  .meta({ ref: 'ProjectsResponse' })

/**
 * First-level directory under Projects Home (ADR 0031). Validated here so a
 * bad path is a 400 with the reason, and again in the repository.
 */
const RelativePath = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) => {
      try {
        parseRelativeProjectPath(value)
        return true
      } catch {
        return false
      }
    },
    {
      message: 'relativePath must be one directory name under Projects Home: no slashes, no dots, never absolute',
    },
  )
  .describe('First-level directory under Projects Home. Never an absolute path.')

const CreateBody = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    relativePath: RelativePath.nullable().optional(),
    taskProvider: TaskProvider.nullable().optional(),
    linearTeam: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'a Linear team key is up to ten uppercase letters or digits')
      .nullable()
      .optional(),
  })
  .strict()
  .meta({ ref: 'CreateProjectBody' })

const PatchBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    relativePath: RelativePath.nullable().optional(),
    /** `null` goes back to deriving it from the repository's own remote. */
    taskProvider: TaskProvider.nullable().optional(),
    /**
     * The team a Linear Project's issues belong to, such as `ENG`.
     *
     * Settable here because it is the other half of choosing Linear: a Project
     * on Linear with no team names nothing, and the refusal an operator gets
     * tells them to set it — which they could not, until this existed.
     */
    linearTeam: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'a Linear team key is up to ten uppercase letters or digits')
      .nullable()
      .optional(),
  })
  .strict()
  .meta({ ref: 'PatchProjectBody' })

const EnvironmentsBody = z
  .object({ environments: z.array(z.string().min(1).max(255)).max(128) })
  .strict()
  .meta({ ref: 'ProjectEnvironmentsBody' })

const Removal = z
  .object({
    ok: z.boolean(),
    removed: z.string(),
    note: z.string().describe('States what was not touched, because that is the question'),
  })
  .strict()
  .meta({ ref: 'ProjectRemoval' })

/**
 * Joins the operator's decisions with what is actually running.
 *
 * The repository and environment lists come from the database; the runtime
 * half comes from the snapshot the panel already has, so a Project with
 * nothing up is a full answer rather than an empty one.
 */
async function assemble(db: Database, snapshot: Snapshot, config: AppDeps['config']) {
  return loadProjectCatalog(db, snapshot, config)
}

function summariesFrom(catalog: ProjectCatalog) {
  return catalog.records.map((record) =>
    toProjectSummary(
      record,
      (catalog.repositoriesByProject.get(record.id) ?? []).length,
      catalog.environments.get(record.id) ?? [],
    ),
  )
}

/** A Zod failure on a stored decision is the caller's mistake, said plainly. */
function refusedOnValidation<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      throw new OverrideRefused(error.issues.map((issue) => issue.message).join('; '))
    }
    throw error
  })
}

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  const home = () => deps.config.projectsHome

  app.get(
    '/projects',
    documentRoute({
      tag: 'Projects',
      operationId: 'listProjects',
      permission: 'project:read',
      summary: 'List Projects',
      response: ProjectsResponse,
      description:
        'A Project is the product the operator recognises. It stays visible with nothing running. See ADR 0031.',
      errors: [500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const catalog = await assemble(db, await deps.cache.get(), deps.config)
      // A listing filters rather than refuses: somebody asking for the Projects
      // wants theirs, not a 403 about somebody else's.
      return c.json({
        projects: visible(principalOf(c), summariesFrom(catalog), (summary) => projectScope(summary.id)),
      })
    },
  )

  app.post(
    '/projects',
    documentRoute({
      tag: 'Projects',
      operationId: 'createProject',
      permission: 'project:create',
      summary: 'Create a Project',
      request: CreateBody,
      response: Project,
      status: 201,
      description:
        'Persists the product. Nothing on this host is started or stopped. relativePath places it under Projects Home; files are never moved.',
      errors: [400, 403, 409, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const body = CreateBody.parse(await c.req.json())
      if (await db.projects.find(body.slug)) {
        throw new HTTPException(409, { message: `a project named '${body.slug}' already exists` })
      }
      const created = await refusedOnValidation(() =>
        db.projects.create({ ...body, description: body.description ?? null, relativePath: body.relativePath ?? null }),
      )
      const principal = principalOf(c)
      await recordActivity(
        { db, hub: deps.hub },
        {
          kind: 'project.created',
          actor: principal.actor,
          actorKind: principal.actorKind,
          project: created.slug,
          projectId: created.id,
          summary: `Project ${created.name} created`,
        },
      )
      await record(deps, c, {
        action: 'project.created',
        resourceType: 'project',
        resourceId: String(created.id),
        resourceName: created.slug,
        projectId: Number(created.id),
      })
      return c.json(toProject(created, [], [], home()), 201)
    },
  )

  app.get(
    '/projects/:slug',
    documentRoute({
      tag: 'Projects',
      operationId: 'getProject',
      permission: 'project:read',
      summary: 'Get one Project',
      response: Project,
      parameters: [slugParameter],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      const record = await db.projects.find(slug)
      if (!record) throw new HTTPException(404, { message: `no project '${slug}'` })
      authorizeScope(c, projectScope(record.id))
      const catalog = await assemble(db, await deps.cache.get(), deps.config)
      return c.json(
        toProject(
          record,
          catalog.repositoriesByProject.get(record.id) ?? [],
          catalog.environments.get(record.id) ?? [],
          home(),
        ),
      )
    },
  )

  app.patch(
    '/projects/:slug',
    documentRoute({
      tag: 'Projects',
      operationId: 'patchProject',
      permission: 'project:update',
      summary: 'Rename, describe, place or archive a Project',
      request: PatchBody,
      response: ProjectSummary,
      parameters: [slugParameter],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      const patch = PatchBody.parse(await c.req.json())
      // Resolved before it is written: the scope check needs an id, and a write
      // that happened before the refusal would be a refusal that changed things.
      const existing = await db.projects.find(slug)
      if (!existing) throw new HTTPException(404, { message: `no project '${slug}'` })
      authorizeScope(c, projectScope(existing.id))
      const updated = await refusedOnValidation(() => db.projects.update(slug, patch))
      if (!updated) throw new HTTPException(404, { message: `no project '${slug}'` })
      const principal = principalOf(c)
      await recordActivity(
        { db, hub: deps.hub },
        {
          kind: 'project.updated',
          actor: principal.actor,
          actorKind: principal.actorKind,
          project: updated.slug,
          projectId: updated.id,
          summary: `Project ${updated.name} updated`,
          data: { fields: Object.keys(patch) },
        },
      )
      await record(deps, c, {
        action: 'project.updated',
        resourceType: 'project',
        resourceId: String(updated.id),
        resourceName: updated.slug,
        projectId: Number(updated.id),
        metadata: { fields: Object.keys(patch) },
      })
      return c.json(toProjectSummary(updated, 0, []))
    },
  )

  /**
   * Removes the grouping and nothing else.
   *
   * This is the endpoint most likely to be misread, so it says what it did not
   * do: no container is stopped, no volume is removed, no environment is
   * changed and no repository is unlinked from GitHub.
   */
  app.delete(
    '/projects/:slug',
    documentRoute({
      tag: 'Projects',
      operationId: 'deleteProject',
      permission: 'project:delete',
      summary: 'Remove a Project grouping',
      description: 'Deletes the grouping only. No container, volume, environment or repository is touched.',
      response: Removal,
      parameters: [slugParameter],
      errors: [403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      const existing = await db.projects.find(slug)
      if (!existing) throw new HTTPException(404, { message: `no project '${slug}'` })
      authorizeScope(c, projectScope(existing.id))
      if (!(await db.projects.remove(slug))) {
        throw new HTTPException(404, { message: `no project '${slug}'` })
      }
      const principal = principalOf(c)
      await recordActivity(
        { db, hub: deps.hub },
        {
          kind: 'project.deleted',
          actor: principal.actor,
          actorKind: principal.actorKind,
          project: slug,
          summary: `Project ${existing.name} removed from the panel`,
          data: { slug },
        },
      )
      // No projectId: the row is gone, and the column would be nulled by the
      // cascade a moment later. The slug is what a person reads anyway.
      await record(deps, c, {
        action: 'project.deleted',
        resourceType: 'project',
        resourceId: String(existing.id),
        resourceName: slug,
      })
      return c.json({
        ok: true,
        removed: slug,
        note: 'the grouping only: no container, volume, environment or repository was touched',
      })
    },
  )

  app.put(
    '/projects/:slug/environments',
    documentRoute({
      tag: 'Projects',
      operationId: 'setProjectEnvironments',
      permission: 'project:update',
      summary: 'Set the environments a Project adopts by hand',
      description: 'A manual mapping always wins over portta.project and over a repository match.',
      request: EnvironmentsBody,
      response: Project,
      parameters: [slugParameter],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      const record = await db.projects.find(slug)
      if (!record) throw new HTTPException(404, { message: `no project '${slug}'` })
      authorizeScope(c, projectScope(record.id))

      const body = EnvironmentsBody.parse(await c.req.json())
      const snapshot = await deps.cache.get()
      for (const name of body.environments) {
        if (!snapshot.environments.some((environment) => environment.name === name)) {
          throw new OverrideRefused(`no environment '${name}' is running`)
        }
      }
      await db.projects.setEnvironments(record.id, body.environments)
      const principal = principalOf(c)
      await recordActivity(
        { db, hub: deps.hub },
        {
          kind: 'environment.adopted',
          actor: principal.actor,
          actorKind: principal.actorKind,
          project: record.slug,
          projectId: record.id,
          summary: `${record.name} adopts ${body.environments.join(', ') || 'no environment'} by hand`,
          data: { environments: body.environments },
        },
      )

      const catalog = await assemble(db, await deps.cache.get(true), deps.config)
      return c.json(
        toProject(
          record,
          catalog.repositoriesByProject.get(record.id) ?? [],
          catalog.environments.get(record.id) ?? [],
          home(),
        ),
      )
    },
  )

  return app
}
