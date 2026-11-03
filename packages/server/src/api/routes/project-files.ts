import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope } from 'portta-auth-core/hono'
import { ProjectFileContent, ProjectFilesView } from 'portta-contracts'
import { isSafeRelativePath } from 'portta-core'
import { requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope } from '../../services/access-control.ts'
import { readFileContent, readFilesIndex } from '../../services/project-files.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The Project slug, as created.',
  schema: { type: 'string' as const },
}
const environmentParameter = {
  name: 'environment',
  in: 'query' as const,
  required: false,
  description: 'One of the project’s environments. Defaults to the first that has files.',
  schema: { type: 'string' as const },
}

export function projectFileRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function resolve(c: { req: { param: (name: string) => string; query: (name: string) => string | undefined } }) {
    const db = requireDatabase(deps.db)
    const project = await db.projects.find(c.req.param('slug'))
    if (!project) throw new HTTPException(404, { message: `no project '${c.req.param('slug')}'` })
    return {
      project,
      names: (await db.projects.listEnvironments())
        .filter((row) => row.projectId === project.id)
        .map((row) => row.composeProject),
    }
  }

  app.get(
    '/projects/:slug/files',
    documentRoute({
      tag: 'Projects',
      operationId: 'listProjectFiles',
      permission: 'project:read',
      summary: 'The files of a project, as the collector published them',
      description:
        'A read-only copy made on the host with secrets left out. The panel never opens the project folder. Files that usually hold secrets, binaries and large files are listed and not shown.',
      response: ProjectFilesView,
      parameters: [slugParameter, environmentParameter],
      errors: [403, 404, 503],
    }),
    async (c) => {
      const { project, names } = await resolve(c)
      authorizeScope(c, projectScope(project.id))
      const withFiles = names.filter((name) => readFilesIndex(deps.config, name) !== null)
      const asked = c.req.query('environment')
      if (asked !== undefined && !names.includes(asked)) {
        throw new HTTPException(404, { message: `'${asked}' is not an environment of this project` })
      }
      const environment = asked ?? withFiles[0] ?? null
      const index = environment ? readFilesIndex(deps.config, environment) : null
      return c.json({
        environments: withFiles,
        environment,
        branch: index?.branch ?? null,
        head: index?.head ?? null,
        changed: index?.changed ?? 0,
        untracked: index?.untracked ?? 0,
        ahead: index?.ahead ?? null,
        collectedAt: index?.collectedAt ?? null,
        truncated: index?.truncated ?? false,
        files: index?.files ?? [],
      })
    },
  )

  app.get(
    '/projects/:slug/files/content',
    documentRoute({
      tag: 'Projects',
      operationId: 'readProjectFile',
      permission: 'project:read',
      summary: 'The text of one file of a project, and its changes',
      description: 'Each read is recorded in the audit log.',
      response: ProjectFileContent,
      parameters: [
        slugParameter,
        { ...environmentParameter, required: true },
        {
          name: 'path',
          in: 'query' as const,
          required: true,
          description: 'A path from the listing.',
          schema: { type: 'string' as const },
        },
      ],
      errors: [400, 403, 404, 503],
    }),
    async (c) => {
      const { project, names } = await resolve(c)
      authorizeScope(c, projectScope(project.id))
      const environment = c.req.query('environment') ?? ''
      const path = c.req.query('path') ?? ''
      if (!isSafeRelativePath(path)) throw new HTTPException(400, { message: 'not a path inside the project' })
      if (!names.includes(environment)) {
        throw new HTTPException(404, { message: `'${environment}' is not an environment of this project` })
      }
      const found = readFileContent(deps.config, environment, path)
      if (!found) throw new HTTPException(404, { message: 'there is no text to show for this file' })
      await record(deps, c, {
        action: 'project_file.read',
        resourceType: 'project',
        resourceId: String(project.id),
        resourceName: project.slug,
        projectId: Number(project.id),
        metadata: { environment, path },
      })
      return c.json({ environment, path, content: found.content, diff: found.diff })
    },
  )

  return app
}
