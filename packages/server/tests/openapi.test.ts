import { readFileSync } from 'node:fs'
import {
  AccessView,
  ConfigView,
  ContainerSummary,
  DockerHost,
  Environment,
  EnvironmentReport,
  GatewayStatus,
  LogsResponse,
  NetworkView,
  Overview,
  ProjectGit,
  RemovalPreview,
  RunnerStatus,
  SecurityReport,
  ServiceConnection,
  ServiceTraefik,
  ShareView,
  TraefikVerdict,
} from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { OpenApiDocument } from '../src/api/openapi.ts'
import { ContainersResponse, StatsResponse } from '../src/api/routes/docker.ts'
import { EnvironmentsResponse } from '../src/api/routes/environments.ts'
import { ServicesResponse } from '../src/api/routes/services.ts'
import { HealthResponse } from '../src/api/routes/status.ts'
import { FULL_HOST } from './fixtures.ts'
import { makeApp } from './helpers.ts'

type OpenApi = {
  openapi: string
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string
        parameters?: { name?: string; in?: string }[]
        requestBody?: unknown
        responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
      }
    >
  >
}

// The generator stamps info.version from the CLI package version in a source
// checkout, so the byte-for-byte
// comparison below has to build the document with that same version rather than
// the fixture's. Without this the two checks contradict each other on every
// release: `npm run openapi` writes the real version and this test demands the
// fixture's, so one of them is always red.
const RELEASED_VERSION = JSON.parse(readFileSync(new URL('../../cli/package.json', import.meta.url), 'utf8'))
  .version as string

let served: ReturnType<typeof serve> | undefined

/** Served once for the file: every test reads the same document. */
function contract() {
  served ??= serve()
  return served
}

async function serve() {
  const { app } = makeApp({ containers: FULL_HOST }, { gatewayVersion: RELEASED_VERSION })
  const response = await app.request('/api/openapi.json')
  expect(response.status).toBe(200)
  return { app, spec: (await response.json()) as OpenApi }
}

describe('the OpenAPI contract', () => {
  it('is OpenAPI 3.1 and includes every registered API operation', async () => {
    const { app, spec } = await contract()
    expect(spec.openapi).toBe('3.1.0')

    const documented = new Set(
      Object.entries(spec.paths).flatMap(([path, item]) =>
        Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    )
    const registered = app.routes
      .filter((route) => route.path.startsWith('/api/') && route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path.slice(4).replace(/:([^/]+)/g, '{$1}')}`)

    for (const route of registered) expect(documented, route).toContain(route)
    for (const item of Object.values(spec.paths)) {
      for (const operation of Object.values(item)) {
        expect(operation.operationId).toBeTruthy()
        expect(Object.keys(operation.responses ?? {})).not.toHaveLength(0)
      }
    }
  })

  it('documents query strings, request bodies, SSE and write refusals', async () => {
    const { spec } = await contract()
    const names = (path: string, method: string) =>
      (spec.paths[path]?.[method]?.parameters ?? []).map((parameter) => parameter.name)

    expect(names('/environments', 'get')).toContain('all')
    expect(names('/docker/containers', 'get')).toEqual(expect.arrayContaining(['ownership', 'state', 'q']))
    expect(names('/gateway/logs', 'get')).toEqual(expect.arrayContaining(['component', 'tail']))
    expect(spec.paths['/config']?.patch?.requestBody).toBeDefined()
    expect(spec.paths['/access']?.post?.requestBody).toBeDefined()
    expect(spec.paths['/events']?.get?.responses?.['200']?.content).toHaveProperty('text/event-stream')

    for (const item of Object.values(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (['post', 'patch', 'delete', 'put'].includes(method)) {
          expect(operation.responses).toHaveProperty('403')
        }
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (Number(status) >= 400) {
            expect(response.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ApiError')
          }
        }
      }
    }
  })

  it('does not put a password example on the connection route', async () => {
    const { spec } = await contract()
    const rendered = JSON.stringify(spec.paths['/access/services/{project}/{service}/connection'])
    expect(rendered).not.toMatch(/"password"\s*:\s*"[^"]+"/)
  })

  it('matches the checked-in snapshot byte for byte', async () => {
    const { spec } = await contract()
    // The document lives in portta-contracts now, and is reached through the
    // export it declares rather than by counting directories out of this one.
    const checkedIn = readFileSync(new URL(import.meta.resolve('portta-contracts/openapi.json')), 'utf8')
    expect(`${JSON.stringify(spec, null, 2)}\n`).toBe(checkedIn)
  })
})

describe('response contracts against the realistic host fixture', () => {
  it('accepts every representative JSON response', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const serviceId = 'a-web'

    const cases: [string, z.ZodType][] = [
      ['/api/health', HealthResponse],
      ['/api/status', Overview],
      ['/api/environments', EnvironmentsResponse],
      ['/api/environments/alpha', Environment],
      ['/api/environments/alpha/git', ProjectGit],
      ['/api/services', ServicesResponse],
      [`/api/services/${serviceId}`, ContainerSummary],
      [`/api/services/${serviceId}/logs`, LogsResponse],
      [`/api/services/${serviceId}/traefik`, ServiceTraefik],
      ['/api/docker/containers', ContainersResponse],
      [`/api/docker/containers/${serviceId}/stats`, StatsResponse],
      [`/api/docker/containers/${serviceId}/removal-preview`, RemovalPreview],
      ['/api/docker/host', DockerHost],
      ['/api/network', NetworkView],
      ['/api/access', AccessView],
      ['/api/access/services/alpha/postgres/connection', ServiceConnection],
      ['/api/shares', ShareView],
      ['/api/runner', RunnerStatus],
      ['/api/gateway', GatewayStatus],
      ['/api/gateway/traefik', TraefikVerdict],
      ['/api/environment', EnvironmentReport],
      ['/api/environment/security', SecurityReport],
      ['/api/config', ConfigView],
      ['/api/openapi.json', OpenApiDocument],
    ]

    for (const [path, schema] of cases) {
      const response = await app.request(path)
      expect(response.status, path).toBe(200)
      const parsed = schema.safeParse(await response.json())
      expect(parsed.success, parsed.success ? path : `${path}: ${parsed.error.message}`).toBe(true)
    }
  })
})
