'use client'

// The API reference, generated from the running panel's own OpenAPI document.
//
// Not a checked-in copy: it fetches `/api/openapi.json` from the panel serving
// this page, so what is documented is what that panel actually answers. Nothing
// else is fetched — no CDN, no schema resolver service, no telemetry.
//
// The console is honest about the two guards the API already enforces. A write
// needs an explicit confirmation here, and read-only mode and the same-origin
// guard are surfaced as the API's own `ApiError` rather than as a generic
// failure, because "the panel refused this" and "the request did not arrive"
// are different things to a reader.

import { AlertTriangle, ChevronDown, Play, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface Schema {
  type?: string
  format?: string
  enum?: unknown[]
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
  description?: string
  default?: unknown
  nullable?: boolean
  $ref?: string
  anyOf?: Schema[]
  oneOf?: Schema[]
}

interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: Schema
}

interface Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: { content?: Record<string, { schema?: Schema }> }
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>
  security?: unknown[]
}

interface Spec {
  info: { title: string; version: string; description?: string }
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, Operation>>
  components?: {
    schemas?: Record<string, Schema>
    securitySchemes?: Record<string, { type: string; scheme?: string; in?: string; name?: string }>
  }
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type Method = (typeof METHODS)[number]

const WRITES = new Set<Method>(['post', 'put', 'patch', 'delete'])

const METHOD_COLOUR: Record<Method, string> = {
  get: 'text-info',
  post: 'text-ok',
  put: 'text-warn',
  patch: 'text-warn',
  delete: 'text-danger',
}

/** `/components/schemas/Issue` -> the schema, one level at a time. */
function resolve(schema: Schema | undefined, spec: Spec, depth = 0): Schema | undefined {
  if (!schema || depth > 6) return schema
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? ''
    return resolve(spec.components?.schemas?.[name], spec, depth + 1)
  }
  return schema
}

/**
 * An example body from a schema.
 *
 * Seeded rather than blank: a reader who has to invent a shape from a type
 * table will not try the console at all, and a wrong-shaped body is the one
 * error the API cannot help them with.
 */
function example(schema: Schema | undefined, spec: Spec, depth = 0): unknown {
  const resolved = resolve(schema, spec)
  if (!resolved || depth > 5) return null
  if (resolved.default !== undefined) return resolved.default
  if (resolved.enum?.length) return resolved.enum[0]
  switch (resolved.type) {
    case 'string':
      return resolved.format === 'date-time' ? new Date().toISOString() : ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      return [example(resolved.items, spec, depth + 1)].filter((value) => value !== null)
    case 'object': {
      const shape: Record<string, unknown> = {}
      for (const [key, property] of Object.entries(resolved.properties ?? {})) {
        // Only what the schema requires: a body full of optional nulls is a
        // worse starting point than a minimal one.
        if (resolved.required?.includes(key)) shape[key] = example(property, spec, depth + 1)
      }
      return shape
    }
    default:
      return null
  }
}

function SchemaView({ schema, spec }: { schema: Schema | undefined; spec: Spec }) {
  const resolved = resolve(schema, spec)
  if (!resolved) return null
  const properties = Object.entries(resolved.properties ?? {})
  if (properties.length === 0) {
    return <p className="text-xs text-muted">{resolved.type ?? 'unspecified'}</p>
  }
  return (
    <table className="w-full text-xs">
      <tbody>
        {properties.map(([name, property]) => {
          const field = resolve(property, spec)
          return (
            <tr key={name} className="border-t border-line">
              <td className="py-1 pr-3 font-mono">
                {name}
                {resolved.required?.includes(name) ? '' : '?'}
              </td>
              <td className="py-1 pr-3 text-subtle">
                {field?.type ?? (property.$ref ? property.$ref.split('/').pop() : 'any')}
              </td>
              <td className="py-1 text-muted">{field?.description ?? property.description ?? ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Console({
  path,
  method,
  operation,
  spec,
}: {
  path: string
  method: Method
  operation: Operation
  spec: Spec
}) {
  const bodySchema = operation.requestBody?.content?.['application/json']?.schema
  const [values, setValues] = useState<Record<string, string>>({})
  const [body, setBody] = useState(() => (bodySchema ? JSON.stringify(example(bodySchema, spec), null, 2) : ''))
  const [result, setResult] = useState<{ status: number; statusText: string; text: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const isWrite = WRITES.has(method)

  // SSE never ends, so a console request against it would hang the page.
  if (path === '/events') {
    return (
      <p className="mt-3 text-xs text-muted">
        A stream, not a request. Open it with <code>curl -N /api/events</code>.
      </p>
    )
  }

  async function run() {
    setBusy(true)
    setFailure(null)
    setResult(null)
    try {
      let url = path
      const query = new URLSearchParams()
      for (const parameter of operation.parameters ?? []) {
        const value = values[parameter.name] ?? ''
        if (!value) {
          if (parameter.required && parameter.in === 'path') {
            setFailure(`${parameter.name} is required`)
            return
          }
          continue
        }
        if (parameter.in === 'path') url = url.replace(`{${parameter.name}}`, encodeURIComponent(value))
        else if (parameter.in === 'query') query.set(parameter.name, value)
      }
      const target = `/api${url}${query.size > 0 ? `?${query}` : ''}`
      const response = await fetch(target, {
        method: method.toUpperCase(),
        headers: { accept: 'application/json', ...(isWrite && body ? { 'content-type': 'application/json' } : {}) },
        ...(isWrite && body ? { body } : {}),
      })
      const text = await response.text()
      let shown = text
      try {
        shown = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* not JSON; show it raw */
      }
      setResult({ status: response.status, statusText: response.statusText, text: shown })
    } catch (error) {
      // Distinguished from a refusal on purpose: this one never reached the panel.
      setFailure(`the request did not reach the panel: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {(operation.parameters ?? []).length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(operation.parameters ?? []).map((parameter) => (
            <label key={`${parameter.in}:${parameter.name}`} className="text-xs">
              <span className="mb-1 block font-mono text-subtle">
                {parameter.name}{' '}
                <span className="font-sans">
                  ({parameter.in}
                  {parameter.required ? ', required' : ''})
                </span>
              </span>
              <input
                value={values[parameter.name] ?? ''}
                onChange={(event) => setValues((previous) => ({ ...previous, [parameter.name]: event.target.value }))}
                placeholder={
                  parameter.schema?.default !== undefined
                    ? String(parameter.schema.default)
                    : (parameter.description ?? '')
                }
                className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono outline-none focus:border-accent"
              />
            </label>
          ))}
        </div>
      )}

      {bodySchema && (
        <label className="block text-xs">
          <span className="mb-1 block text-subtle">Request body</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={Math.min(14, body.split('\n').length + 1)}
            spellCheck={false}
            className="w-full rounded-md border border-line bg-surface p-2 font-mono outline-none focus:border-accent"
          />
        </label>
      )}

      {isWrite && confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
          <span>
            This sends a real <strong>{method.toUpperCase()}</strong> to this panel. It changes what is running.
          </span>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="ml-auto rounded-md bg-danger px-2.5 py-1 font-medium text-accent-fg"
          >
            {busy ? 'Sending…' : 'Send it'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-line px-2.5 py-1"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (isWrite ? setConfirming(true) : void run())}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent"
        >
          <Play className="size-3" aria-hidden />
          {busy ? 'Sending…' : `Try ${method.toUpperCase()}`}
        </button>
      )}

      {failure && <p className="text-xs text-danger">{failure}</p>}

      {result && (
        <div>
          <p className={`font-mono text-xs ${result.status < 400 ? 'text-ok' : 'text-danger'}`}>
            {result.status} {result.statusText}
            {result.status === 403 && (
              <span className="ml-2 font-sans text-muted">— read-only mode, or the same-origin write guard</span>
            )}
          </p>
          <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-line bg-surface-2 p-2 text-xs">
            {result.text}
          </pre>
        </div>
      )}
    </div>
  )
}

function OperationView({
  path,
  method,
  operation,
  spec,
}: {
  path: string
  method: Method
  operation: Operation
  spec: Spec
}) {
  const anchor = operation.operationId ?? `${method}-${path}`
  const [open, setOpen] = useState(() => window.location.hash.endsWith(anchor))
  const responses = Object.entries(operation.responses ?? {})

  return (
    <details
      id={anchor}
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-line bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
        <ChevronDown
          className="size-3.5 shrink-0 text-subtle transition-transform [details[open]_&]:rotate-180"
          aria-hidden
        />
        <span className={`w-14 shrink-0 font-mono text-[11px] font-bold uppercase ${METHOD_COLOUR[method]}`}>
          {method}
        </span>
        <span className="truncate font-mono text-sm">{path}</span>
        <span className="ml-auto hidden truncate text-xs text-muted sm:block">{operation.summary}</span>
      </summary>
      <div className="border-t border-line px-3 py-3">
        {operation.description && <p className="mb-3 text-sm text-muted">{operation.description}</p>}

        {operation.requestBody && (
          <section className="mb-3">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">Request body</h4>
            <SchemaView schema={operation.requestBody.content?.['application/json']?.schema} spec={spec} />
          </section>
        )}

        <section className="mb-1">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">Responses</h4>
          <ul className="space-y-1 text-xs">
            {responses.map(([status, response]) => (
              <li key={status} className="flex gap-2">
                <span className={`w-8 shrink-0 font-mono ${Number(status) < 400 ? 'text-ok' : 'text-danger'}`}>
                  {status}
                </span>
                <span className="text-muted">{response.description}</span>
              </li>
            ))}
          </ul>
        </section>

        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-subtle">Success schema</summary>
          <div className="mt-1">
            <SchemaView
              schema={responses.find(([status]) => Number(status) < 400)?.[1]?.content?.['application/json']?.schema}
              spec={spec}
            />
          </div>
        </details>

        <Console path={path} method={method} operation={operation} spec={spec} />
      </div>
    </details>
  )
}

export function ApiReference() {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    void fetch('/api/openapi.json', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`the panel answered ${response.status}`)
        return response.json() as Promise<Spec>
      })
      .then((value) => {
        if (!cancelled) setSpec(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const grouped = useMemo(() => {
    if (!spec) return []
    const needle = filter.trim().toLowerCase()
    const byTag = new Map<string, Array<{ path: string; method: Method; operation: Operation }>>()
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of METHODS) {
        const operation = item[method]
        if (!operation) continue
        const haystack =
          `${method} ${path} ${operation.summary ?? ''} ${(operation.tags ?? []).join(' ')}`.toLowerCase()
        if (needle && !haystack.includes(needle)) continue
        const tag = operation.tags?.[0] ?? 'Other'
        byTag.set(tag, [...(byTag.get(tag) ?? []), { path, method, operation }])
      }
    }
    const order = (spec.tags ?? []).map((tag) => tag.name)
    return [...byTag.entries()].sort(([a], [b]) => {
      const rank = (name: string) => {
        const at = order.indexOf(name)
        return at === -1 ? order.length : at
      }
      return rank(a) - rank(b)
    })
  }, [spec, filter])

  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/10 p-4">
        <p className="flex items-center gap-2 font-medium">
          <ShieldAlert className="size-4 text-danger" aria-hidden /> The API reference could not load
        </p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <p className="mt-2 text-xs text-muted">
          The reference is generated from this panel’s live contract. It is off when
          <code className="mx-1">PORTTA_RUNTIME_API_DOCS=false</code>, which is the default once the panel is routed.
        </p>
      </div>
    )
  }

  if (!spec) return <p className="text-sm text-muted">Reading the contract…</p>

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{spec.info.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{spec.info.description}</p>
      <p className="mt-1 text-xs text-subtle">
        Version {spec.info.version} · generated from this panel ·{' '}
        <a className="underline hover:text-accent" href="/api/openapi.json">
          the raw document
        </a>
      </p>

      {spec.components?.securitySchemes && (
        <p className="mt-3 text-xs text-muted">
          Authentication:{' '}
          {Object.entries(spec.components.securitySchemes)
            .map(([name, scheme]) => `${name} (${scheme.scheme ?? scheme.type}${scheme.in ? ` in ${scheme.in}` : ''})`)
            .join(' · ')}
        </p>
      )}

      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter operations"
        aria-label="Filter operations"
        className="mt-5 w-full max-w-sm rounded-md border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
      />

      <div className="mt-6 space-y-8">
        {grouped.map(([tag, operations]) => (
          <section key={tag}>
            <h2 className="text-lg font-semibold">{tag}</h2>
            <p className="mb-2 text-sm text-muted">{spec.tags?.find((entry) => entry.name === tag)?.description}</p>
            <div className="space-y-1.5">
              {operations.map((entry) => (
                <OperationView key={`${entry.method} ${entry.path}`} {...entry} spec={spec} />
              ))}
            </div>
          </section>
        ))}
        {grouped.length === 0 && <p className="text-sm text-muted">Nothing matches “{filter}”.</p>}
      </div>
    </div>
  )
}
