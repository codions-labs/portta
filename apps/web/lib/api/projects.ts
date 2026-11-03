// Projects: the product the operator recognises, and what it owns.

import type {
  DiscoveredFoldersView,
  FolderPlanView,
  Project,
  ProjectFileContent,
  ProjectFilesView,
  ProjectSummary,
  ProjectTag,
} from 'portta-contracts'
import { request } from './client.ts'

export const projectsApi = {
  projectFiles: (slug: string, environment?: string) =>
    request<ProjectFilesView>(
      `/projects/${encodeURIComponent(slug)}/files${environment ? `?environment=${encodeURIComponent(environment)}` : ''}`,
    ),
  projectFile: (slug: string, environment: string, path: string) =>
    request<ProjectFileContent>(
      `/projects/${encodeURIComponent(slug)}/files/content?environment=${encodeURIComponent(environment)}&path=${encodeURIComponent(path)}`,
    ),
  projects: () => request<{ projects: ProjectSummary[] }>('/projects').then((data) => data.projects),
  project: (slug: string) => request<Project>(`/projects/${encodeURIComponent(slug)}`),
  discoveredFolders: () => request<DiscoveredFoldersView>('/discovery/folders'),
  folderPlan: (path: string) => request<FolderPlanView>(`/discovery/plan?path=${encodeURIComponent(path)}`),
  createProject: (body: { slug: string; name: string; description: string | null; relativePath?: string | null }) =>
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
  setProjectTags: (slug: string, tags: ProjectTag[]) =>
    request<ProjectSummary>(`/projects/${encodeURIComponent(slug)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    }),
  setProjectEnvironments: (slug: string, environments: string[]) =>
    request<Project>(`/projects/${encodeURIComponent(slug)}/environments`, {
      method: 'PUT',
      body: JSON.stringify({ environments }),
    }),
}
