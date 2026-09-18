// The accounts, the tokens, and the record of what was done to both.
//
// All three are the panel's own API rather than Better Auth's client: the rules
// about who may act on whom, what a token may hold and what gets recorded are
// Portta's, and calling the library directly would go around them.

import type {
  AgentPermissions,
  ApiToken,
  ApiTokens,
  AuditPage,
  BanUser,
  CreateApiToken,
  CreatedApiToken,
  CreateUser,
  Role,
  User,
  UserSessions,
  Users,
} from 'portta-contracts'
import { request } from './client.ts'

export interface AuditFilters {
  limit?: string | undefined
  before?: string | undefined
  user?: string | undefined
  project?: string | undefined
  action?: string | undefined
}

function query(filters: AuditFilters): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value)
  const suffix = search.toString()
  return suffix ? `?${suffix}` : ''
}

export const adminApi = {
  users: () => request<Users>('/users').then((body) => body.users),
  user: (id: string) => request<User>(`/users/${encodeURIComponent(id)}`),
  createUser: (body: CreateUser) => request<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
  setUserRole: (id: string, role: Role) =>
    request<User>(`/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  setUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/users/${encodeURIComponent(id)}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    }),
  banUser: (id: string, body: BanUser) =>
    request<User>(`/users/${encodeURIComponent(id)}/ban`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeUser: (id: string) => request<{ ok: true }>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  userSessions: (id: string) =>
    request<UserSessions>(`/users/${encodeURIComponent(id)}/sessions`).then((body) => body.sessions),
  revokeUserSessions: (id: string) =>
    request<{ ok: true }>(`/users/${encodeURIComponent(id)}/sessions`, { method: 'DELETE' }),
  setUserProjects: (id: string, projects: number[]) =>
    request<User>(`/users/${encodeURIComponent(id)}/projects`, { method: 'PUT', body: JSON.stringify({ projects }) }),
  transferOwnership: (id: string) =>
    request<User>(`/users/${encodeURIComponent(id)}/transfer-ownership`, { method: 'POST' }),

  apiTokens: (all = false) => request<ApiTokens>(`/auth/tokens${all ? '?all=true' : ''}`).then((body) => body.tokens),
  createApiToken: (body: CreateApiToken) =>
    request<CreatedApiToken>('/auth/tokens', { method: 'POST', body: JSON.stringify(body) }),
  revokeApiToken: (id: string) =>
    request<{ ok: true; revoked: string }>(`/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  audit: (filters: AuditFilters = {}) => request<AuditPage>(`/audit${query(filters)}`),

  agentPermissions: () => request<AgentPermissions>('/settings/agent-permissions'),
  setAgentPermissions: (permissions: string[] | null) =>
    request<AgentPermissions>('/settings/agent-permissions', {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
}

export type { ApiToken }
