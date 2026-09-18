// Projects: the product the operator recognises, and what it owns.

import type { Project, ProjectSummary } from 'portta-contracts'
import { request } from './client.ts'

export const projectsApi = {
  projects: () => request<{ projects: ProjectSummary[] }>('/projects').then((data) => data.projects),
  project: (slug: string) => request<Project>(`/projects/${encodeURIComponent(slug)}`),
  createProject: (body: { slug: string; name: string; description: string | null }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  patchProject: (slug: string, body: Record<string, unknown>) =>
    request<ProjectSummary>(`/projects/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProject: (slug: string) =>
    request<{ ok: boolean; removed: string; note: string }>(`/projects/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      body: '{}',
    }),
  setProjectEnvironments: (slug: string, environments: string[]) =>
    request<Project>(`/projects/${encodeURIComponent(slug)}/environments`, {
      method: 'PUT',
      body: JSON.stringify({ environments }),
    }),
}
