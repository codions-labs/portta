// Activity: what happened in the development flow, with references.

import type { ActivityEvent } from 'portta-contracts'
import { request } from './client.ts'

export type ActivityFilters = Partial<
  Record<'kind' | 'issue' | 'repository' | 'environment' | 'session' | 'actor' | 'before' | 'limit', string>
>

export interface ActivityPage {
  events: ActivityEvent[]
  nextBefore: string | null
}

/** The server answers `{ events, nextBefore? }`; a bare array is accepted too. */
function page(payload: unknown): ActivityPage {
  if (Array.isArray(payload)) return { events: payload as ActivityEvent[], nextBefore: null }
  const data = (payload ?? {}) as { events?: ActivityEvent[]; nextBefore?: string | null }
  return { events: data.events ?? [], nextBefore: data.nextBefore ?? null }
}

function query(filters: ActivityFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

export const activityApi = {
  projectActivity: (slug: string, filters: ActivityFilters = {}) =>
    request<unknown>(`/projects/${encodeURIComponent(slug)}/activity${query(filters)}`).then(page),
}
