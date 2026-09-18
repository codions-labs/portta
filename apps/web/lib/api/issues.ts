// Issues, and whether this host can reach them at all.
//
// Everything is scoped to a Project, because the Project is what decides which
// GitHub repository or Linear team a request is about. There is no global issue
// list: a ref that names a repository no Project is linked to is not addressable
// from here, deliberately.

import type { ForgeStatus, Issue, IssueRunContext, IssueSummary, IssueVocabulary } from 'portta-contracts'
import { request } from './client.ts'

export interface IssueFilters {
  state?: 'open' | 'closed' | 'all'
  assignee?: string
  label?: string
  milestone?: string
  q?: string
}

function query(filters: IssueFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const search = params.toString()
  return search ? `?${search}` : ''
}

/** The provider's own key: a number on GitHub, `ENG-42` on Linear. */
function keyOf(ref: string): string {
  const separator = ref.indexOf(':')
  const key = separator > 0 ? ref.slice(separator + 1) : ref
  const hash = key.lastIndexOf('#')
  return hash > 0 ? key.slice(hash + 1) : key
}

export interface CreateIssueInput {
  title: string
  body?: string
  labels?: string[]
  assignees?: string[]
  milestone?: string
}

export interface PatchIssueInput {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  stateReason?: 'completed' | 'not planned'
  addLabels?: string[]
  removeLabels?: string[]
  addAssignees?: string[]
  removeAssignees?: string[]
  milestone?: string
}

const path = (project: string) => `/projects/${encodeURIComponent(project)}/issues`

export const issuesApi = {
  issues: (project: string, filters: IssueFilters = {}) =>
    request<{ issues: IssueSummary[] }>(`${path(project)}${query(filters)}`).then((data) => data.issues),

  issue: (project: string, ref: string) =>
    request<{ issue: Issue }>(`${path(project)}/${encodeURIComponent(keyOf(ref))}`).then((data) => data.issue),

  issueVocabulary: (project: string) =>
    request<{ vocabulary: IssueVocabulary }>(`/projects/${encodeURIComponent(project)}/issues-vocabulary`).then(
      (data) => data.vocabulary,
    ),

  createIssue: (project: string, input: CreateIssueInput) =>
    request<{ issue: Issue }>(path(project), { method: 'POST', body: JSON.stringify(input) }).then(
      (data) => data.issue,
    ),

  patchIssue: (project: string, ref: string, input: PatchIssueInput) =>
    request<{ issue: Issue }>(`${path(project)}/${encodeURIComponent(keyOf(ref))}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }).then((data) => data.issue),

  commentOnIssue: (project: string, ref: string, body: string) =>
    request<{ issue: Issue }>(`${path(project)}/${encodeURIComponent(keyOf(ref))}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }).then((data) => data.issue),

  issueRunContext: (project: string, ref: string) =>
    request<{ context: IssueRunContext }>(`${path(project)}/${encodeURIComponent(keyOf(ref))}/run-context`).then(
      (data) => data.context,
    ),

  startIssueRun: (project: string, ref: string, input: { harness: string; type?: string; branch?: string }) =>
    request<{ runId: string }>(`${path(project)}/${encodeURIComponent(keyOf(ref))}/runs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  forgeStatus: () => request<ForgeStatus>('/issues/status'),
}
