import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ActionResult,
  ContainerSummary,
  DockerDiskUsage,
  DockerHost,
  DockerImageList,
  DockerNetworkList,
  DockerPruneBody,
  DockerPruneResult,
  DockerResourceRemoveBody,
  DockerResourceRemoveResult,
  DockerVolumeList,
  LogsResponse,
  type Ownership,
  RemovalPreview,
} from 'portta-contracts'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import { findContainer, removalPreview, removeContainer, runContainerAction } from '../../services/actions.ts'
import * as cleanup from '../../services/cleanup.ts'
import { record } from '../audit.ts'
import { containerIdParameter, documentRoute, tailParameter } from '../openapi.ts'
import { readLogs } from './services.ts'

const ownershipFilter = z.enum(['all', 'gateway', 'integrated', 'external', 'standalone'])
const stateFilter = z.enum(['all', 'running', 'stopped', 'unhealthy'])

const removeBody = z.object({ confirm: z.literal(true), force: z.boolean().optional() }).strict()

export const ContainersResponse = z
  .object({
    containers: z.array(ContainerSummary),
    total: z.number().int(),
  })
  .strict()
  .meta({ ref: 'ContainersResponse' })
export const StatsResponse = z
  .object({
    cpuPercent: z.number().nullable(),
    memoryBytes: z.number().nullable(),
    memoryLimit: z.number().nullable(),
  })
  .strict()
  .meta({ ref: 'ContainerStatsResponse' })

export function dockerRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Every container on the host, gateway-owned or not. The classification
  // travels with each row so the UI never has to guess.
  app.get(
    '/docker/containers',
    documentRoute({
      tag: 'Docker',
      operationId: 'listContainers',
      permission: 'container:read',
      summary: 'List every container on the host',
      response: ContainersResponse,
      parameters: [
        {
          name: 'ownership',
          in: 'query',
          required: false,
          description: 'Filter by gateway ownership class.',
          schema: { type: 'string', enum: ownershipFilter.options, default: 'all' },
        },
        {
          name: 'state',
          in: 'query',
          required: false,
          description: 'Filter by runtime state.',
          schema: { type: 'string', enum: stateFilter.options, default: 'all' },
        },
        {
          name: 'q',
          in: 'query',
          required: false,
          description: 'Case-insensitive search over name, image, project, service and hosts.',
          schema: { type: 'string' },
        },
      ],
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const ownership = ownershipFilter.catch('all').parse(c.req.query('ownership'))
      const state = stateFilter.catch('all').parse(c.req.query('state'))
      const search = (c.req.query('q') ?? '').trim().toLowerCase()

      const containers = snapshot.containers.filter((container) => {
        if (ownership !== 'all' && container.ownership !== (ownership as Ownership)) return false
        if (state === 'running' && container.state !== 'running') return false
        if (state === 'stopped' && container.state === 'running') return false
        if (state === 'unhealthy' && container.health !== 'unhealthy') return false
        if (search !== '') {
          const haystack = [
            container.name,
            container.image,
            container.environment ?? '',
            container.service ?? '',
            ...container.urls.map((url) => url.host),
          ]
            .join(' ')
            .toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      })

      return c.json({ containers, total: snapshot.containers.length })
    },
  )

  app.get(
    '/docker/containers/:id',
    documentRoute({
      tag: 'Docker',
      operationId: 'getContainer',
      permission: 'container:read',
      summary: 'Get one container',
      response: ContainerSummary,
      parameters: [containerIdParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      return c.json(findContainer(snapshot, c.req.param('id')))
    },
  )

  app.get(
    '/docker/containers/:id/logs',
    documentRoute({
      tag: 'Docker',
      operationId: 'getContainerLogs',
      permission: 'logs:read',
      summary: 'Read recent container logs',
      response: LogsResponse,
      parameters: [containerIdParameter, tailParameter],
      errors: [404, 500, 502],
    }),
    async (c) => c.json(await readLogs(deps, c.req.param('id'), c.req.query('tail'))),
  )

  // Optional and cheap: one shot, never a stream. Nothing else depends on it.
  app.get(
    '/docker/containers/:id/stats',
    documentRoute({
      tag: 'Docker',
      operationId: 'getContainerStats',
      permission: 'container:read',
      summary: 'Get a one-shot resource sample',
      response: StatsResponse,
      parameters: [containerIdParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const container = findContainer(snapshot, c.req.param('id'))
      if (container.state !== 'running') return c.json({ cpuPercent: null, memoryBytes: null, memoryLimit: null })
      const stats = await deps.client.stats(container.id).catch(() => null)
      if (!stats) return c.json({ cpuPercent: null, memoryBytes: null, memoryLimit: null })

      const cpuDelta =
        (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0)
      const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0)
      const cpus = stats.cpu_stats?.online_cpus ?? 1
      const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cpus * 100 : 0

      const cache = stats.memory_stats?.stats?.inactive_file ?? 0
      const memoryBytes = Math.max(0, (stats.memory_stats?.usage ?? 0) - cache)

      return c.json({
        cpuPercent: Number(cpuPercent.toFixed(1)),
        memoryBytes,
        memoryLimit: stats.memory_stats?.limit ?? null,
      })
    },
  )

  // What a removal would take with it, so the confirmation can be specific.
  app.get(
    '/docker/containers/:id/removal-preview',
    documentRoute({
      tag: 'Docker',
      operationId: 'previewContainerRemoval',
      permission: 'container:read',
      summary: 'Preview a bounded container removal',
      response: RemovalPreview,
      parameters: [containerIdParameter],
      errors: [400, 404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      return c.json(removalPreview(snapshot, c.req.param('id')))
    },
  )

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(
      `/docker/containers/:id/${action}`,
      documentRoute({
        tag: 'Docker',
        operationId: `${action}Container`,
        permission: 'container:operate',
        summary: `${action[0]?.toUpperCase()}${action.slice(1)} a container`,
        response: ActionResult,
        parameters: [containerIdParameter],
        errors: [400, 403, 404, 409, 500, 502],
      }),
      async (c) => {
        const snapshot = await deps.cache.get()
        const container = await runContainerAction(deps.client, snapshot, c.req.param('id'), action)
        deps.cache.invalidate()
        await record(deps, c, {
          action: 'container.operated',
          resourceType: 'container',
          resourceId: container.id,
          resourceName: container.name,
          metadata: { operation: action },
        })
        return c.json({
          ok: true,
          action,
          containerId: container.id,
          message: `${action} sent to ${container.name}`,
        })
      },
    )
  }

  app.delete(
    '/docker/containers/:id',
    documentRoute({
      tag: 'Docker',
      operationId: 'removeContainer',
      permission: 'container:destroy',
      summary: 'Remove a gateway-allowed container only',
      description: 'Volumes, networks, links and images are always kept.',
      response: ActionResult,
      request: removeBody,
      parameters: [containerIdParameter],
      errors: [400, 403, 404, 409, 500, 502],
    }),
    async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const parsed = removeBody.safeParse(body)
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: 'a removal has to be confirmed explicitly: send {"confirm": true}',
        })
      }

      const snapshot = await deps.cache.get()
      const container = await removeContainer(deps.client, snapshot, c.req.param('id'), {
        force: parsed.data.force === true,
      })
      deps.cache.invalidate()
      await record(deps, c, {
        action: 'container.destroyed',
        resourceType: 'container',
        resourceId: container.id,
        resourceName: container.name,
        metadata: { force: parsed.data.force === true },
      })
      return c.json({
        ok: true,
        action: 'remove',
        containerId: container.id,
        message: `removed ${container.name}; volumes, networks and images were kept`,
      })
    },
  )

  app.get(
    '/docker/host',
    documentRoute({
      tag: 'Docker',
      operationId: 'getDockerHost',
      permission: 'docker:read',
      summary: 'Get Docker Engine and host summary',
      response: DockerHost,
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const count = (ownership: Ownership) =>
        snapshot.containers.filter((container) => container.ownership === ownership).length

      const host: DockerHost = {
        engine: {
          version: snapshot.version?.Version ?? snapshot.info?.ServerVersion ?? 'unknown',
          apiVersion: snapshot.version?.ApiVersion ?? 'unknown',
          os: snapshot.info?.OperatingSystem ?? snapshot.version?.Os ?? 'unknown',
          arch: snapshot.info?.Architecture ?? snapshot.version?.Arch ?? 'unknown',
          cpus: snapshot.info?.NCPU ?? 0,
          memoryBytes: snapshot.info?.MemTotal ?? 0,
          name: snapshot.info?.Name ?? 'unknown',
        },
        containers: {
          total: snapshot.info?.Containers ?? snapshot.containers.length,
          running:
            snapshot.info?.ContainersRunning ??
            snapshot.containers.filter((container) => container.state === 'running').length,
          paused: snapshot.info?.ContainersPaused ?? 0,
          stopped:
            snapshot.info?.ContainersStopped ??
            snapshot.containers.filter((container) => container.state !== 'running').length,
        },
        byOwnership: {
          gateway: count('gateway'),
          integrated: count('integrated'),
          external: count('external'),
          standalone: count('standalone'),
        },
        networks: snapshot.networks,
        ports: snapshot.ports,
      }
      return c.json(host)
    },
  )

  // -- cleaning: networks, images, volumes ------------------------------------
  // Reading is `docker:read`. Everything that removes is `docker:destroy`, which
  // only an owner and an administrator hold. The server decides what may go: a
  // protected resource is reported back as skipped, whatever the request says.

  const listing = (operationId: string, summary: string, description: string, response: z.ZodType) =>
    documentRoute({
      tag: 'Docker',
      operationId,
      permission: 'docker:read',
      summary,
      description,
      response,
      errors: [500, 502],
    })

  app.get(
    '/docker/networks',
    listing(
      'listDockerNetworks',
      'List the Docker networks and which ones may be removed',
      'Every network carries `protection`: null when it may be removed, otherwise why not (Portta, a Docker default, or in use).',
      DockerNetworkList,
    ),
    async (c) => c.json(await cleanup.listNetworks(deps.client, deps.config)),
  )

  app.get(
    '/docker/images',
    listing(
      'listDockerImages',
      'List the Docker images with their sizes',
      'Sizes come from the Docker disk usage report, so the call can take a moment on a host with many images.',
      DockerImageList,
    ),
    async (c) => c.json(await cleanup.listImages(deps.client, deps.config)),
  )

  app.get(
    '/docker/volumes',
    listing(
      'listDockerVolumes',
      'List the Docker volumes with their sizes',
      'A volume with a null size is one whose driver does not report it.',
      DockerVolumeList,
    ),
    async (c) => c.json(await cleanup.listVolumes(deps.client, deps.config)),
  )

  app.get(
    '/docker/usage',
    listing(
      'getDockerDiskUsage',
      'Summarise what a cleanup could free',
      'The counts a prune would act on, taken from the same rules the prune uses.',
      DockerDiskUsage,
    ),
    async (c) => c.json(await cleanup.diskUsage(deps.client, deps.config)),
  )

  const removals = [
    { path: 'networks', kind: 'network', operationId: 'removeDockerNetworks', remove: cleanup.removeNetworks },
    { path: 'images', kind: 'image', operationId: 'removeDockerImages', remove: cleanup.removeImages },
    { path: 'volumes', kind: 'volume', operationId: 'removeDockerVolumes', remove: cleanup.removeVolumes },
  ] as const

  for (const entry of removals) {
    app.post(
      `/docker/${entry.path}/remove`,
      documentRoute({
        tag: 'Docker',
        operationId: entry.operationId,
        permission: 'docker:destroy',
        summary: `Remove Docker ${entry.path}`,
        description:
          'Removes what is allowed and reports the rest one by one. Nothing is forced: a resource that Portta owns, that Docker keeps as a default, or that a container still uses is skipped.',
        response: DockerResourceRemoveResult,
        request: DockerResourceRemoveBody,
        errors: [400, 403, 500, 502],
      }),
      async (c) => {
        const parsed = DockerResourceRemoveBody.safeParse(await c.req.json().catch(() => ({})))
        if (!parsed.success) {
          throw new HTTPException(400, {
            message: 'a removal has to be confirmed and name what to remove: send {"confirm": true, "ids": [...]}',
          })
        }
        const result = await entry.remove(deps.client, deps.config, parsed.data.ids)
        deps.cache.invalidate()
        await record(deps, c, {
          action: 'docker.resources_removed',
          resourceType: entry.kind,
          resourceName:
            result.results
              .filter((outcome) => outcome.ok)
              .map((outcome) => outcome.name)
              .join(', ')
              .slice(0, 500) || null,
          metadata: {
            requested: parsed.data.ids.length,
            removed: result.removed,
            skipped: result.skipped,
            failed: result.failed,
            freedBytes: result.freedBytes,
          },
        })
        return c.json(result)
      },
    )
  }

  app.post(
    '/docker/prune',
    documentRoute({
      tag: 'Docker',
      operationId: 'pruneDocker',
      permission: 'docker:destroy',
      summary: 'Remove what nothing uses',
      description:
        'The panel lists the candidates and removes them one at a time, so Portta components, default networks and anything a container still references stay. `dryRun: true` lists and removes nothing.',
      response: DockerPruneResult,
      request: DockerPruneBody,
      errors: [400, 403, 500, 502],
    }),
    async (c) => {
      const parsed = DockerPruneBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: 'a prune has to be confirmed and say what to sweep: send {"confirm": true, "dryRun": ..., ...}',
        })
      }
      const { confirm: _confirm, ...plan } = parsed.data
      const result = await cleanup.prune(deps.client, deps.config, plan)
      if (!plan.dryRun) {
        deps.cache.invalidate()
        await record(deps, c, {
          action: 'docker.pruned',
          resourceType: 'docker',
          metadata: {
            containers: plan.containers,
            networks: plan.networks,
            images: plan.images,
            volumes: plan.volumes,
            removed: result.removed,
            failed: result.failed,
            freedBytes: result.freedBytes,
          },
        })
      }
      return c.json(result)
    },
  )

  return app
}
