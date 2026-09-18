import { apiContract } from './contract.ts'
import type { RouteDefinition, RouteRequest, RouteSuccessBody, RouteTable } from './routes.ts'

export interface ApiClientOptions {
  /** Headers sent with every call, such as `Authorization`. */
  baseHeaders?: Record<string, string>
  /** Transport override, for tests and non-browser runtimes. */
  fetch?: typeof fetch
}

type RouteCall<TRoute extends RouteDefinition> =
  Record<never, never> extends RouteRequest<TRoute>
    ? (request?: RouteRequest<TRoute>) => Promise<RouteSuccessBody<TRoute>>
    : (request: RouteRequest<TRoute>) => Promise<RouteSuccessBody<TRoute>>

export type ApiClient<TTable extends RouteTable = typeof apiContract> = {
  [K in keyof TTable]: RouteCall<TTable[K]>
}

interface RawRequest {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessageFromResponse(body: unknown, status: number): string {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown
      return errorMessageFromResponse(parsed, status)
    } catch {
      return body.trim() || `HTTP ${status}`
    }
  }
  if (isRecord(body) && typeof body.error === 'string') {
    return body.error
  }
  return `HTTP ${status}`
}

// Path params are encoded before they are inserted into `/api/.../:name/...`,
// so names like `feature/foo` stay one segment.
function interpolatePath(path: string, params: Record<string, unknown> = {}): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => encodeURIComponent(String(params[name] ?? '')))
}

function queryString(query: Record<string, unknown> = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else {
      search.set(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value))
    }
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('json')) return response.json()
  return response.text()
}

async function call(
  route: RouteDefinition,
  baseUrl: string,
  options: ApiClientOptions,
  request: RawRequest = {},
): Promise<unknown> {
  const headers: Record<string, string> = { ...options.baseHeaders, ...request.headers }
  const init: RequestInit = { method: route.method, headers }
  if (request.body !== undefined) {
    if (request.body instanceof FormData) {
      init.body = request.body
    } else {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(request.body)
    }
  }
  const url = `${baseUrl}${interpolatePath(route.path, request.params)}${queryString(request.query)}`
  const response = await (options.fetch ?? fetch)(url, init)
  const body = await readBody(response)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorMessageFromResponse(body, response.status))
  }
  return body
}

/** A client whose calls resolve to the success body and throw `Error(message)`
 *  with the server's `error` field on any other status. */
export function createApi(baseUrl: string, options: ApiClientOptions = {}): ApiClient {
  const client: Record<string, (request?: RawRequest) => Promise<unknown>> = {}
  for (const [name, route] of Object.entries(apiContract)) {
    client[name] = (request) => call(route, baseUrl, options, request)
  }
  // The table is walked at runtime, so the per-route signatures are asserted once here.
  return client as unknown as ApiClient
}
