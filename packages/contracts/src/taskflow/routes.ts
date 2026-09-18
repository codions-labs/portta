import type { z } from 'zod'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** One HTTP operation of the host API: where it lives, what it accepts and
 *  what it answers per status. The host registers and documents its handlers
 *  from these entries and the client derives its calls from them. */
export interface RouteDefinition {
  method: HttpMethod
  path: string
  summary: string
  pathParams?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
  responses: { [status: number]: z.ZodType }
}

export type RouteTable = Record<string, RouteDefinition>

export function defineRoutes<const T extends RouteTable>(routes: T): T {
  return routes
}

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226

type PathParamNames<TPath extends string> = TPath extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParamNames<`/${Rest}`>
  : TPath extends `${string}:${infer Param}`
    ? Param
    : never

type SchemaInput<TSchema> = TSchema extends z.ZodType ? z.input<TSchema> : never

type RouteParams<TRoute extends RouteDefinition> = TRoute['pathParams'] extends z.ZodType
  ? z.input<TRoute['pathParams']>
  : [PathParamNames<TRoute['path']>] extends [never]
    ? never
    : Record<PathParamNames<TRoute['path']>, string>

type RequestParts<TRoute extends RouteDefinition> = {
  params: RouteParams<TRoute>
  query: SchemaInput<TRoute['query']>
  body: SchemaInput<TRoute['body']>
}

type PresentKeys<T> = { [K in keyof T]: [T[K]] extends [never] ? never : K }[keyof T]

type OptionalKeys<T> = {
  [K in keyof T]: Record<never, never> extends T[K] ? K : undefined extends T[K] ? K : never
}[keyof T]

type Prettify<T> = { [K in keyof T]: T[K] }

/** The argument of a client call: only the parts the route declares, each
 *  optional when every field in it is. */
export type RouteRequest<TRoute extends RouteDefinition> = Prettify<
  { [K in Exclude<PresentKeys<RequestParts<TRoute>>, OptionalKeys<RequestParts<TRoute>>>]: RequestParts<TRoute>[K] } & {
    [K in Extract<PresentKeys<RequestParts<TRoute>>, OptionalKeys<RequestParts<TRoute>>>]?: RequestParts<TRoute>[K]
  } & { headers?: Record<string, string> }
>

/** The body of the route's successful response. */
export type RouteSuccessBody<TRoute extends RouteDefinition> = {
  [S in keyof TRoute['responses']]: S extends SuccessStatus ? z.infer<TRoute['responses'][S]> : never
}[keyof TRoute['responses']]
