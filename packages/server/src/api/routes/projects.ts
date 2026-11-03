import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { Project, ProjectSummary } from 'portta-contracts'
import { parseRelativeProjectPath } from 'portta-core'
import { z } from 'portta-core/zod'
import { type Database, requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope, visible } from '../../services/access-control.ts'
import { loadProjectCatalog, type ProjectCatalog, toProject, toProjectSummary } from '../../services/catalog.ts'
import { releaseCrawlerExceptions } from '../../services/crawlers.ts'
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
 * Directory under Projects Home, at any depth (ADR 0031). Validated here so a
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
      message: 'relativePath must stay under Projects Home: relative, no dot segments, no hidden directory',
    },
  )
  .describe('Directory under Projects Home, such as group/project. Never an absolute path.')

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
  })
  .strict()
  .meta({ ref: 'CreateProjectBody' })

const PatchBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    relativePath: RelativePath.nullable().optional(),
  })
  .strict()
  .meta({ ref: 'PatchProjectBody' })

const TagsBody = z
  .object({
    tags: z.array(z.object({ key: z.string().max(32).default(''), value: z.string().min(1).max(64) }).strict()).max(16),
  })
  .strict()
  .meta({ ref: 'ProjectTagsBody' })

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
 * The Project list comes from the database; the runtime
 * half comes from the snapshot the panel already has, so a Project with
 * nothing up is a full answer rather than an empty one.
 */
async function assemble(db: Database, snapshot: Snapshot, config: AppDeps['config']) {
  return loadProjectCatalog(db, snapshot, config)
}

function summariesFrom(catalog: ProjectCatalog) {
  return catalog.records.map((record) =>
    toProjectSummary(record, catalog.environments.get(record.id) ?? [], catalog.tags.get(record.id) ?? []),
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
      await record(deps, c, {
        action: 'project.created',
        resourceType: 'project',
        resourceId: String(created.id),
        resourceName: created.slug,
        projectId: Number(created.id),
      })
      return c.json(toProject(created, [], home()), 201)
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
        toProject(record, catalog.environments.get(record.id) ?? [], home(), catalog.tags.get(record.id) ?? []),
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
      await record(deps, c, {
        action: 'project.updated',
        resourceType: 'project',
        resourceId: String(updated.id),
        resourceName: updated.slug,
        projectId: Number(updated.id),
        metadata: { fields: Object.keys(patch) },
      })
      return c.json(toProjectSummary(updated, [], (await db.projects.listTags()).get(updated.id) ?? []))
    },
  )

  /**
   * Removes the grouping and nothing else.
   *
   * This is the endpoint most likely to be misread, so it says what it did not
   * do: no container is stopped, no volume is removed, no environment is
   * changed.
   */
  app.delete(
    '/projects/:slug',
    documentRoute({
      tag: 'Projects',
      operationId: 'deleteProject',
      permission: 'project:delete',
      summary: 'Remove a Project grouping',
      description: 'Deletes the grouping only. No container, volume or environment is touched.',
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
        note: 'the grouping only: no container, volume or environment was touched',
      })
    },
  )

  app.put(
    '/projects/:slug/tags',
    documentRoute({
      tag: 'Projects',
      operationId: 'setProjectTags',
      permission: 'project:update',
      summary: 'Set the tags of a Project',
      description:
        'Replaces them all. A tag is a label to group and filter by, such as `cliente: Acme`; it grants and hides nothing.',
      request: TagsBody,
      response: ProjectSummary,
      parameters: [slugParameter],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      const existing = await db.projects.find(slug)
      if (!existing) throw new HTTPException(404, { message: `no project '${slug}'` })
      authorizeScope(c, projectScope(existing.id))
      const body = TagsBody.parse(await c.req.json())
      const tags = await refusedOnValidation(() => db.projects.setTags(existing.id, body.tags))
      await record(deps, c, {
        action: 'project.tagged',
        resourceType: 'project',
        resourceId: String(existing.id),
        resourceName: existing.slug,
        projectId: Number(existing.id),
        metadata: { tags: tags.length },
      })
      return c.json(toProjectSummary(existing, [], tags))
    },
  )

  app.put(
    '/projects/:slug/environments',
    documentRoute({
      tag: 'Projects',
      operationId: 'setProjectEnvironments',
      permission: 'project:update',
      summary: 'Set the environments a Project adopts by hand',
      description: 'A manual mapping always wins over portta.project and over a directory match.',
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
      const before = new Set(
        (await db.projects.listEnvironments())
          .filter((row) => row.projectId === record.id)
          .map((row) => row.composeProject),
      )
      await db.projects.setEnvironments(record.id, body.environments)
      // An exception was a decision about the project that had the environment, not about the environment.
      const after = new Set(body.environments)
      releaseCrawlerExceptions(deps.config, [
        ...[...before].filter((name) => !after.has(name)),
        ...[...after].filter((name) => !before.has(name)),
      ])

      const catalog = await assemble(db, await deps.cache.get(true), deps.config)
      return c.json(
        toProject(record, catalog.environments.get(record.id) ?? [], home(), catalog.tags.get(record.id) ?? []),
      )
    },
  )

  return app
}
