// Issues are read live from a provider, so they are cached briefly and
// refetched on focus: a stale issue list is a wrong answer, not an old one.
//
// `retry: false` for the status query, because a host with no `gh` answers the
// same way every time and three retries only delay the message that says so.

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { IssueFilters } from '@/lib/api/issues.ts'
import { keys } from './keys.ts'

/** Long enough that opening an issue and going back does not refetch; short enough to be current. */
const FRESH_MS = 15_000

export function useIssues(project: string, filters: IssueFilters = {}) {
  return useQuery({
    queryKey: keys.issues(project, { ...filters }),
    queryFn: () => api.issues(project, filters),
    staleTime: FRESH_MS,
    retry: false,
  })
}

export function useIssue(project: string, ref: string) {
  return useQuery({
    queryKey: keys.issue(project, ref),
    queryFn: () => api.issue(project, ref),
    staleTime: FRESH_MS,
    retry: false,
  })
}

/** Fetched when a form opens, and kept: a repository's labels do not change while somebody types. */
export function useIssueVocabulary(project: string, enabled = true) {
  return useQuery({
    queryKey: keys.issueVocabulary(project),
    queryFn: () => api.issueVocabulary(project),
    staleTime: 5 * 60_000,
    retry: false,
    enabled,
  })
}

export function useForgeStatus() {
  return useQuery({ queryKey: keys.forgeStatus(), queryFn: api.forgeStatus, retry: false })
}
