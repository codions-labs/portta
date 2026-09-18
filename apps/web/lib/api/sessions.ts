// Development sessions: who is working on what, since when.

import type { Session } from 'portta-contracts'
import { request } from './client.ts'

export interface SessionBody {
  issueRef?: string | null
  repositoryId?: string | null
  environmentId?: string | null
  summary?: string | null
  agent?: string | null
}

export const sessionsApi = {
  sessions: (slug: string, filters: { active?: boolean; issue?: string } = {}) => {
    const params = new URLSearchParams()
    if (filters.active) params.set('active', 'true')
    if (filters.issue) params.set('issue', filters.issue)
    const suffix = params.toString()
    return request<{ sessions: Session[] }>(
      `/projects/${encodeURIComponent(slug)}/sessions${suffix ? `?${suffix}` : ''}`,
    ).then((data) => data.sessions)
  },
  session: (id: string) => request<Session>(`/sessions/${encodeURIComponent(id)}`),
  startSession: (slug: string, body: SessionBody) =>
    request<Session>(`/projects/${encodeURIComponent(slug)}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
  patchSession: (
    id: string,
    body: { status?: 'active' | 'ended' | 'abandoned'; summary?: string | null; heartbeat?: boolean },
  ) => request<Session>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
}
