import type { Hono, MiddlewareHandler } from 'hono'
import type { DescribeRouteOptions, GenerateSpecOptions } from 'hono-openapi'
import { describeRoute, generateSpecs, resolver } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Permission } from 'portta-auth-core'
import { authorize } from 'portta-auth-core'
import { principalOf } from 'portta-auth-core/hono'
import { ApiError, LiveEvent } from 'portta-contracts'
import { z } from 'zod'
import type { PanelConfig } from '../config.ts'
import { type ModuleApiTag, moduleTags, SERVER_MODULES } from '../modules/index.ts'

type BaseApiTag =
  | 'Status'
  | 'Projects'
  | 'Repositories'
  | 'Environments'
  | 'Issues'
  | 'Sessions'
  | 'Activity'
  | 'Services'
  | 'Docker'
  | 'Network'
  | 'Access'
  | 'Shares'
  | 'Gateway'
  | 'Configuration'
  | 'Events'
  | 'Documentation'
  | 'Authentication'
  | 'Users'
  | 'SSH'

export type ApiTag = BaseApiTag | ModuleApiTag

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503

/**
 * What a route needs, or that it needs nothing.
 *
 * Three shapes rather than an optional field, so a new route cannot forget:
 * a permission, `public` for the handful that answer without a credential, or
 * `authenticated` for the one that only needs to know who is asking — `/auth/me`
 * describes the caller, so any principal may read it and none may read another.
 */
export type RouteAuthorization =
  | { permission: Permission; public?: never; authenticated?: never }
  | { public: true; permission?: never; authenticated?: never }
  | { authenticated: true; permission?: never; public?: never }

export type RouteDocumentation = RouteAuthorization & {
  tag: ApiTag
  operationId: string
  summary: string
  description?: string
  response: z.ZodType
  status?: number
  responseDescription?: string
  mediaType?: string
  example?: unknown
  parameters?: OpenAPIV3_1.ParameterObject[]
  request?: z.ZodType
  requestDescription?: string
  /**
   * How the request body arrives. Everything the panel takes is JSON except an
   * upload, which is multipart because that is what a browser's file input and
   * a `curl -F` both already speak.
   */
  requestMediaType?: string
  /** For a body this schema language cannot describe, such as a binary part. */
  requestSchemaOverride?: OpenAPIV3_1.SchemaObject
  errors?: ErrorStatus[]
}

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'The request is invalid or the requested action was refused.',
  401: 'No credential was sent: sign in, or send a Portta token.',
  403: 'The panel is read-only, the write is cross-origin, or the operation is outside the panel allowlist.',
  404: 'The requested project, service, container, share or endpoint does not exist.',
  409: 'The requested operation conflicts with the current runtime state.',
  500: 'The panel encountered an unexpected failure.',
  502: 'Docker, Traefik or another local upstream returned an error.',
  503: 'A required local dependency is unavailable.',
}

function errorResponse(status: ErrorStatus) {
  return {
    description: ERROR_DESCRIPTIONS[status],
    content: { 'application/json': { schema: resolver(ApiError) } },
  }
}

function requestSchema(schema: z.ZodType): OpenAPIV3_1.SchemaObject {
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  const { $schema: _dialect, ...inline } = generated
  return inline as OpenAPIV3_1.SchemaObject
}

export function documentRoute(doc: RouteDocumentation): MiddlewareHandler {
  const status = String(doc.status ?? 200)
  const mediaType = doc.mediaType ?? 'application/json'
  const responses: NonNullable<DescribeRouteOptions['responses']> = {
    [status]: {
      description: doc.responseDescription ?? 'Successful response.',
      content: {
        [mediaType]: {
          schema: resolver(doc.response),
          ...(doc.example === undefined ? {} : { example: doc.example }),
        },
      },
    },
  }
  for (const error of doc.errors ?? [500]) responses[String(error)] = errorResponse(error)

  const spec: DescribeRouteOptions = {
    tags: [doc.tag],
    operationId: doc.operationId,
    summary: doc.summary,
    description: doc.description,
    parameters: doc.parameters,
    responses,
    security: doc.public ? [{}] : [{ cookieAuth: [] }, { bearerAuth: [] }],
    ...(doc.authenticated ? { 'x-portta-authenticated': true } : {}),
  }
  if (doc.request || doc.requestSchemaOverride) {
    spec.requestBody = {
      required: true,
      description: doc.requestDescription,
      content: {
        [doc.requestMediaType ?? 'application/json']: {
          schema: doc.requestSchemaOverride ?? requestSchema(doc.request!),
        },
      },
    }
  }
  if (doc.permission) PERMISSION_BY_OPERATION.set(doc.operationId, doc.permission)
  // hono-openapi finds a documented route by a marker it puts on the
  // middleware it returns, so the permission check wraps that middleware and
  // carries the marker across rather than hiding it behind a combinator.
  //
  // The scope is not decided here. It comes later, in the handler or the
  // service, once the resource has been read and the Project it belongs to is
  // known; what this refuses first is a caller who could never be allowed.
  const described = describeRoute(spec)
  const permission = doc.permission
  const guarded: MiddlewareHandler = async (c, next) => {
    // `principalOf` throws 401 on its own when nothing resolved, which is what
    // an `authenticated` route needs and all a permission check would do first.
    if (doc.authenticated) principalOf(c)
    if (permission) {
      authorize(principalOf(c), permission)
      // Left on the context so the handler can ask about the same permission
      // once it knows which Project the resource belongs to.
      c.set('permission', permission)
    }
    return described(c, next)
  }
  for (const key of Reflect.ownKeys(described)) {
    const descriptor = Object.getOwnPropertyDescriptor(described, key)
    if (descriptor && key !== 'length' && key !== 'name' && key !== 'prototype')
      Object.defineProperty(guarded, key, descriptor)
  }
  return guarded
}

/** Every documented operation and the permission it declared, for the contract. */
export const PERMISSION_BY_OPERATION = new Map<string, Permission>()

/** Stamp x-portta-permission on each operation, from what documentRoute recorded. */
function withPermissions<T extends { paths?: Record<string, unknown> }>(document: T): T {
  for (const path of Object.values(document.paths ?? {})) {
    if (!path || typeof path !== 'object') continue
    for (const operation of Object.values(path as Record<string, unknown>)) {
      if (!operation || typeof operation !== 'object') continue
      const op = operation as Record<string, unknown>
      const permission = typeof op.operationId === 'string' ? PERMISSION_BY_OPERATION.get(op.operationId) : undefined
      if (permission) op['x-portta-permission'] = permission
    }
  }
  return document
}

export const containerIdParameter: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Docker container id, not a Compose service name.',
  schema: { type: 'string' },
}

export const projectParameter: OpenAPIV3_1.ParameterObject = {
  name: 'project',
  in: 'path',
  required: true,
  description: 'COMPOSE_PROJECT_NAME of a running project.',
  schema: { type: 'string' },
}

export const shareIdParameter: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Opaque share id returned when the share was created.',
  schema: { type: 'string' },
}

export const bridgeIdParameter: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Gateway-owned bridge container id returned when the bridge was opened.',
  schema: { type: 'string' },
}

export const tailParameter: OpenAPIV3_1.ParameterObject = {
  name: 'tail',
  in: 'query',
  required: false,
  description: 'Maximum number of log lines, clamped to 1–2000.',
  schema: { type: 'integer', minimum: 1, maximum: 2000, default: 200 },
}

export const OpenApiDocument = z
  .object({
    openapi: z.literal('3.1.0'),
    info: z.object({ title: z.string(), version: z.string() }).passthrough(),
    paths: z.record(z.string(), z.unknown()),
    components: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .meta({ ref: 'OpenApiDocument' })

export function openApiOptions(version: string): Partial<GenerateSpecOptions> {
  return {
    excludeStaticFile: false,
    documentation: {
      info: {
        title: 'Portta panel API',
        version,
        summary: 'Runtime inventory and bounded control for Portta.',
        description:
          'The API used by the panel UI, the CLI and local agents. Every operation that is not public declares the permission it needs (x-portta-permission), and the panel decides: a session cookie or a Portta token names a user, and their role says what they hold. Read-only mode leaves every principal with the reads alone, and an agent that announces itself with X-Portta-Actor holds what the agentPermissions setting grants. Writes can also be refused by the same-origin guard.',
        license: { name: 'MIT' },
      },
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      servers: [{ url: '/api', description: 'This panel instance' }],
      tags: [
        { name: 'Status', description: 'Liveness and overview.' },
        { name: 'Projects', description: 'The product the operator recognises. Persisted. See ADR 0031.' },
        {
          name: 'Repositories',
          description:
            "A Project's code: registered here, observed by the host scan. GitHub is optional metadata on it.",
        },
        { name: 'Environments', description: 'Compose environments running on this host.' },
        { name: 'Issues', description: 'The GitHub issue projection, and writes that go back to GitHub.' },
        {
          name: 'Sessions',
          description: 'Who is working on what, since when, and what came out. A person or an agent.',
        },
        {
          name: 'Activity',
          description: 'What happened in the development flow: issues, sessions, commits, environments. Not a log.',
        },
        { name: 'Services', description: 'Containers belonging to adopted projects.' },
        { name: 'Docker', description: 'Bounded host inventory and lifecycle operations.' },
        { name: 'Network', description: 'Routes, networks, DNS, TLS and VPN state.' },
        { name: 'Access', description: 'Temporary loopback bridges to private TCP services.' },
        { name: 'Shares', description: 'Expiring per-service Traefik routes.' },
        { name: 'Gateway', description: 'Gateway components, diagnostics and logs.' },
        { name: 'Configuration', description: 'The closed settings catalogue.' },
        { name: 'Events', description: 'Server-sent runtime events.' },
        { name: 'Documentation', description: 'The machine contract and its offline browser.' },
        { name: 'Authentication', description: 'Who this request is, and how a person or an agent becomes somebody.' },
        {
          name: 'Users',
          description: 'The accounts this panel signs in, their roles, and the Projects each one reaches.',
        },
        { name: 'SSH', description: 'The SSH keys Portta owns, for the hosts it reaches on your behalf.' },
        ...moduleTags(SERVER_MODULES),
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'portta.session_token',
            description: 'The session the panel issues at sign-in. The browser sends it; nothing else should.',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description:
              'A revocable Portta API token, for the CLI and coding agents. It begins with ptt_ and is shown only once, when it is created.',
          },
        },
      },
    },
  }
}

export async function generateOpenApi(api: Hono, version: string) {
  return withPermissions(await generateSpecs(api, openApiOptions(version)))
}

export function registerOpenApiRoutes(api: Hono, config: PanelConfig): void {
  api.get(
    '/openapi.json',
    documentRoute({
      tag: 'Documentation',
      operationId: 'getOpenApiDocument',
      permission: 'gateway:read',
      summary: 'Return the OpenAPI 3.1 contract',
      response: OpenApiDocument,
      responseDescription: 'The contract generated from the registered routes.',
    }),
    async (c) => c.json(await generateOpenApi(api, config.gatewayVersion)),
  )
}

export const eventStreamResponse = LiveEvent.describe(
  'Schema of the JSON value in each SSE data frame. Keepalive ping frames contain a Unix timestamp string.',
)
