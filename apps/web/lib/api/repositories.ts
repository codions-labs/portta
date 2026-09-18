// Repositories: a Project's Git, registered by the operator and observed by
// the host scan. GitHub is optional metadata on top.

import type {
  Commit,
  DiscoveredRepository,
  InstructionFile,
  Repository,
  RepositoryGit,
  RouteUrl,
} from 'portta-contracts'
import { request } from './client.ts'

export interface RepositoryEnvironmentRow {
  environment: string
  running: boolean
  serviceCount: number
  runningCount: number
  completedCount?: number
  unhealthyCount: number
  urls: RouteUrl[]
}

export interface CreateRepositoryBody {
  name?: string
  role?: string | null
  localPath?: string | null
  relativePath?: string | null
  remoteUrl?: string | null
  scanKey?: string
  githubRepositoryId?: string | null
  githubFullName?: string
}

export interface PatchRepositoryBody {
  name?: string
  role?: string | null
  localPath?: string | null
  relativePath?: string | null
  remoteUrl?: string | null
  githubRepositoryId?: string | null
  githubFullName?: string | null
  position?: number
}

const id = (value: string) => encodeURIComponent(value)

export const repositoriesApi = {
  discoveredRepositories: () =>
    request<{ repositories: DiscoveredRepository[] }>('/repositories/discovered').then((data) => data.repositories),
  createRepository: (slug: string, body: CreateRepositoryBody) =>
    request<Repository>(`/projects/${id(slug)}/repositories`, { method: 'POST', body: JSON.stringify(body) }),
  repository: (repositoryId: string) => request<Repository>(`/repositories/${id(repositoryId)}`),
  patchRepository: (repositoryId: string, body: PatchRepositoryBody) =>
    request<Repository>(`/repositories/${id(repositoryId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRepository: (repositoryId: string) =>
    request<{ ok: boolean; removed: string; note: string }>(`/repositories/${id(repositoryId)}`, {
      method: 'DELETE',
      body: '{}',
    }),
  repositoryGit: (repositoryId: string) => request<RepositoryGit>(`/repositories/${id(repositoryId)}/git`),
  repositoryCommits: (repositoryId: string) =>
    request<{ commits: Commit[]; collectedAt: number | null; stale: boolean }>(
      `/repositories/${id(repositoryId)}/commits`,
    ),
  repositoryInstructions: (repositoryId: string) =>
    request<{ instructions: InstructionFile[]; collectedAt: number | null; stale: boolean }>(
      `/repositories/${id(repositoryId)}/instructions`,
    ),
  repositoryEnvironments: (repositoryId: string) =>
    request<{ environments: RepositoryEnvironmentRow[] }>(`/repositories/${id(repositoryId)}/environments`).then(
      (data) => data.environments,
    ),
}
