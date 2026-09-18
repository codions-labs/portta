import type { Context, Hono, MiddlewareHandler, Next } from 'hono'
import {
  type DescribeRouteOptions,
  describeRoute,
  type GenerateSpecOptions,
  generateSpecs,
  resolver,
} from 'hono-openapi'
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'
import { apiContract, type RouteDefinition } from 'portta-contracts/taskflow'
import { z } from 'zod'
import { parseJsonValue, parseValue, readSearchParams } from './api-validation.ts'

export type ApiTag =
  | 'Configuration'
  | 'Environments'
  | 'Endpoints'
  | 'Branches'
  | 'Project'
  | 'Agents'
  | 'Worktrees'
  | 'Linear'
  | 'GitHub'
  | 'Runs'
  | 'Notifications'
  | 'Projects'

const TAGS: Record<ApiTag, string> = {
  Configuration: 'Project configuration and host readiness checks.',
  Environments: 'Execution environments of worktrees and Runs, and their services.',
  Endpoints: 'Private local endpoints of environment services.',
  Branches: 'Branches available to new worktrees.',
  Project: 'The live snapshot of one Project.',
  Agents: 'Agent definitions and the agents UI conversation of a worktree.',
  Worktrees: 'Worktree lifecycle, terminals and prompts.',
  Linear: 'The Linear integration.',
  GitHub: 'The GitHub integration and the main branch.',
  Runs: 'Workflows, Direct and Workflow Runs, their events and transcripts.',
  Notifications: 'Runtime events reported by agent hooks and the notifications they raise.',
  Projects: 'The Projects this host serves.',
}

const STATUS_DESCRIPTIONS: Record<number, string> = {
  200: 'Successful response.',
  201: 'Created.',
  400: 'The request is invalid.',
  401: 'The request carries no valid Bearer token.',
  403: 'The operation is outside the host allowlist.',
  404: 'The Project, worktree, Run or resource does not exist.',
  409: 'The operation conflicts with the current state.',
  500: 'The host encountered an unexpected failure.',
  502: 'An upstream integration returned an error.',
  503: 'A required local dependency is unavailable.',
}

export type ContractKey = keyof typeof apiContract

type Output<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : undefined

export interface RouteInput<TRoute extends RouteDefinition> {
  params: Output<TRoute['pathParams']>
  query: Output<TRoute['query']>
  body: Output<TRoute['body']>
}

export type ContractHandler<K extends ContractKey> = (
  c: Context,
  input: RouteInput<(typeof apiContract)[K]>,
  next: Next,
) => Response | Promise<Response>

// What a request accepts is the schema's input side, so transforms such as
// `'true'` → `true` are documented by what the client sends.
function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...inline } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  })
  return inline
}

function queryParameters(schema: z.ZodType | undefined): OpenAPIV3.ParameterObject[] {
  if (!(schema instanceof z.ZodObject)) return []
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    in: 'query',
    required: !(field instanceof z.ZodOptional),
    schema: inputSchema(field) as OpenAPIV3.SchemaObject,
  }))
}

/** The OpenAPI description of a contract route, keyed by its contract name. */
export function describeContractRoute(key: ContractKey, tag: ApiTag): MiddlewareHandler {
  const route: RouteDefinition = apiContract[key]
  const responses: NonNullable<DescribeRouteOptions['responses']> = {}
  for (const [status, schema] of Object.entries(route.responses)) {
    responses[status] = {
      description: STATUS_DESCRIPTIONS[Number(status)] ?? 'Response.',
      content: { 'application/json': { schema: resolver(schema, { unrepresentable: 'any' }) } },
    }
  }
  return describeRoute({
    tags: [tag],
    operationId: key,
    summary: route.summary,
    responses,
    parameters: queryParameters(route.query),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: inputSchema(route.body) as OpenAPIV3_1.SchemaObject } },
          },
        }
      : {}),
  })
}

/** Register a contract route: documented under its contract key, with path
 *  params, query and JSON body validated against the contract schemas before
 *  the handler runs. A failed validation answers 400 `{ error }`. */
export function contractRoute<K extends ContractKey>(
  app: Hono,
  key: K,
  tag: ApiTag,
  handler: ContractHandler<K>,
): void {
  const route: RouteDefinition = apiContract[key]
  app.on(route.method, route.path, describeContractRoute(key, tag), async (c, next) => {
    const params = route.pathParams
      ? parseValue(route.pathParams, c.req.param(), 'Invalid path parameters')
      : { ok: true as const, data: undefined }
    if (!params.ok) return params.response
    const query = route.query
      ? parseValue(route.query, readSearchParams(new URL(c.req.url)), 'Invalid query')
      : { ok: true as const, data: undefined }
    if (!query.ok) return query.response
    const body = route.body ? parseJsonValue(route.body, await c.req.text()) : { ok: true as const, data: undefined }
    if (!body.ok) return body.response
    // Each part was parsed by the schema the contract declares for it.
    const input = { params: params.data, query: query.data, body: body.data } as RouteInput<(typeof apiContract)[K]>
    return handler(c, input, next)
  })
}

/** Describe a route the contract table does not list (streams, uploads, hooks). */
export function describeHostRoute(options: {
  tag: ApiTag
  operationId: string
  summary: string
  mediaType?: string
  responses?: number[]
}): MiddlewareHandler {
  const responses: NonNullable<DescribeRouteOptions['responses']> = {}
  for (const status of options.responses ?? [200]) {
    responses[String(status)] = {
      description: STATUS_DESCRIPTIONS[status] ?? 'Response.',
      ...(status < 300 && options.mediaType ? { content: { [options.mediaType]: {} } } : {}),
    }
  }
  return describeRoute({ tags: [options.tag], operationId: options.operationId, summary: options.summary, responses })
}

export function openApiOptions(version: string): Partial<GenerateSpecOptions> {
  return {
    documentation: {
      info: {
        title: 'Portta host Taskflow API',
        version,
        description:
          'The HTTP API of the Taskflow host module, used by the dashboard and the CLI. Project routes live under `/{prefix}`; a non-loopback host requires `Authorization: Bearer <token>` on every request.',
        license: { name: 'MIT' },
      },
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      tags: Object.entries(TAGS).map(([name, description]) => ({ name, description })),
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
      security: [{ bearerAuth: [] }],
    },
  }
}

export function generateOpenApi(app: Hono, version: string): ReturnType<typeof generateSpecs> {
  return generateSpecs(app, openApiOptions(version))
}
