'use client'

// The accounts, the tokens, the audit log and the agent's ceiling.
//
// Read here, written by the pages that own each form: a mutation belongs beside
// the thing it changes, and the key it invalidates comes from here so the two
// cannot disagree.

import { useQuery } from '@tanstack/react-query'
import type { AuditFilters } from '../api/index.ts'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useUsers(enabled = true) {
  return useQuery({ queryKey: keys.users(), queryFn: api.users, enabled })
}

export function useUserSessions(id: string, enabled = true) {
  return useQuery({ queryKey: keys.userSessions(id), queryFn: () => api.userSessions(id), enabled })
}

export function useApiTokens(all = false) {
  return useQuery({ queryKey: keys.apiTokens(all), queryFn: () => api.apiTokens(all) })
}

export function useAudit(filters: AuditFilters = {}) {
  return useQuery({ queryKey: keys.audit({ ...filters }), queryFn: () => api.audit(filters) })
}

export function useAgentPermissions() {
  return useQuery({ queryKey: keys.agentPermissions(), queryFn: api.agentPermissions })
}
