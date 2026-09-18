import type { z } from 'zod'
import { errorResponse } from '../lib/http.ts'

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response }

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid request'
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  const remainingCount = error.issues.length - 1
  const remainingSuffix =
    remainingCount > 0 ? ` (and ${remainingCount} more error${remainingCount === 1 ? '' : 's'})` : ''
  return `${path}${issue.message}${remainingSuffix}`
}

export function readSearchParams(url: URL): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    if (values.length === 1) {
      data[key] = values[0] ?? ''
      continue
    }
    data[key] = values
  }
  return data
}

export function parseValue<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  label: string,
): ParseResult<z.infer<TSchema>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(`${label}: ${formatZodError(parsed.error)}`, 400),
    }
  }
  return {
    ok: true,
    data: parsed.data,
  }
}

/** Parse a raw JSON request body. An empty body is read as `{}`. */
export function parseJsonValue<TSchema extends z.ZodType>(
  schema: TSchema,
  text: string,
): ParseResult<z.infer<TSchema>> {
  let raw: unknown
  try {
    raw = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return {
      ok: false,
      response: errorResponse('Invalid JSON', 400),
    }
  }
  return parseValue(schema, raw, 'Invalid request body')
}

export function parseQuery<TSchema extends z.ZodType>(req: Request, schema: TSchema): ParseResult<z.infer<TSchema>> {
  return parseValue(schema, readSearchParams(new URL(req.url)), 'Invalid query')
}
