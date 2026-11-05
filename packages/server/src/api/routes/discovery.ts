import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { DiscoveredFoldersView, FolderPlanView } from 'portta-contracts'
import { adoptCommand, isDiscoverablePath } from 'portta-core'
import { requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { readDiscoveredFolders, readFolderPlan } from '../../services/discovery.ts'
import { documentRoute } from '../openapi.ts'

export function discoveryRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get(
    '/discovery/folders',
    documentRoute({
      tag: 'Projects',
      operationId: 'listDiscoveredFolders',
      permission: 'settings:read',
      summary: 'The folders under Projects Home that hold a Compose file',
      description:
        'Found by the host collector, which publishes them every few minutes. The panel never opens Projects Home.',
      response: DiscoveredFoldersView,
      errors: [403, 503],
    }),
    async (c) => {
      const index = readDiscoveredFolders(deps.config)
      const taken = new Set(
        (await requireDatabase(deps.db).projects.list()).flatMap((project) =>
          project.relativePath ? [project.relativePath] : [],
        ),
      )
      return c.json({
        home: index?.home ?? null,
        collectedAt: index?.collectedAt ?? null,
        folders: (index?.folders ?? []).map((folder) => ({ ...folder, registered: taken.has(folder.path) })),
      })
    },
  )

  app.get(
    '/discovery/plan',
    documentRoute({
      tag: 'Projects',
      operationId: 'getFolderPlan',
      permission: 'settings:read',
      summary: 'What adopting a discovered folder would do',
      description:
        'The same read-only report as `portta analyze`. Only a folder the collector listed can be asked about.',
      response: FolderPlanView,
      parameters: [
        {
          name: 'path',
          in: 'query' as const,
          required: true,
          description: 'A path from the folder list.',
          schema: { type: 'string' as const },
        },
      ],
      errors: [400, 403, 404, 503],
    }),
    (c) => {
      const path = c.req.query('path') ?? ''
      if (!isDiscoverablePath(path)) throw new HTTPException(400, { message: 'not a folder under Projects Home' })
      const plan = readFolderPlan(deps.config, path)
      if (!plan) throw new HTTPException(404, { message: 'the collector has no plan for this folder yet' })
      const home = readDiscoveredFolders(deps.config)?.home ?? '~/projects'
      return c.json({ ...plan, home, command: adoptCommand(path, {}, home, plan.project.name) })
    },
  )

  return app
}
