// One fetch, one error shape. Every module under lib/api/ builds on this.

export class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      // A string body is JSON; FormData is not, and the browser has to set its
      // own multipart content-type with the boundary in it.
      ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
      'X-Portta-Source': 'web',
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string | { message?: string }; message?: string; hint?: string }
    const message =
      typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? response.statusText)
    throw new ApiError(response.status, message, body.hint ?? '')
  }
  return payload as T
}
