// Environments: one Compose project on this Node, and what the panel may do to it.

import type {
  Environment,
  EnvironmentActionResult,
  EnvironmentOverrides,
  EnvironmentRemovalPreview,
  EnvironmentRunnerStartResult,
  EnvironmentServices,
  ProjectGit,
  ProjectLogsResponse,
  ProjectRebuildResult,
  ProjectRemoveResult,
  ServiceOverrides,
} from 'portta-contracts'
import { request } from './client.ts'

export const environmentsApi = {
  /** Iterates the containers; a remembered environment (none left) is started through the runner instead, with a different result shape. */
  environmentAction: (name: string, action: 'start' | 'stop' | 'restart') =>
    request<EnvironmentActionResult | EnvironmentRunnerStartResult>(
      `/environments/${encodeURIComponent(name)}/actions/${action}`,
      {
        method: 'POST',
        body: '{}',
      },
    ),
  /** Drops a remembered environment (containers already gone) from the panel's memory. Live ones are refused. */
  forgetEnvironment: (name: string) =>
    request<{ ok: boolean; forgotten: string }>(`/environments/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      body: '{}',
    }),
  environmentRemovalPreview: (name: string) =>
    request<EnvironmentRemovalPreview>(`/environments/${encodeURIComponent(name)}/removal-preview`),
  rebuildEnvironment: (name: string, body: { noCache?: boolean } = {}) =>
    request<ProjectRebuildResult>(`/environments/${encodeURIComponent(name)}/operations/rebuild`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeEnvironment: (
    name: string,
    body: { confirmation: string; volumes: boolean; directory: boolean; overrideDirty?: boolean },
  ) =>
    request<ProjectRemoveResult>(`/environments/${encodeURIComponent(name)}/operations/remove`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  environments: (all = true) =>
    request<{ environments: Environment[] }>(`/environments${all ? '?all=true' : ''}`).then(
      (data) => data.environments,
    ),
  environment: (name: string) => request<Environment>(`/environments/${encodeURIComponent(name)}`),
  /** The consolidated Service rows: state, access, resources and the actions that apply. */
  environmentServices: (name: string) =>
    request<EnvironmentServices>(`/environments/${encodeURIComponent(name)}/services`),
  serviceAction: (name: string, service: string, action: 'start' | 'stop' | 'restart') =>
    request<{ ok: boolean; message?: string }>(
      `/environments/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/actions/${action}`,
      { method: 'POST', body: '{}' },
    ),
  environmentGit: (name: string) => request<ProjectGit>(`/environments/${encodeURIComponent(name)}/git`),
  environmentLogs: (name: string, options: { tail?: number; service?: string | null } = {}) => {
    const query = new URLSearchParams()
    if (options.tail !== undefined) query.set('tail', String(options.tail))
    if (options.service) query.set('service', options.service)
    const suffix = query.toString()
    return request<ProjectLogsResponse>(`/environments/${encodeURIComponent(name)}/logs${suffix ? `?${suffix}` : ''}`)
  },
  environmentSettings: (name: string) =>
    request<EnvironmentOverrides>(`/environments/${encodeURIComponent(name)}/settings`),
  setEnvironmentSettings: (name: string, body: Record<string, unknown>) =>
    request<EnvironmentOverrides>(`/environments/${encodeURIComponent(name)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  clearEnvironmentSettings: (name: string) =>
    request<{ ok: boolean; cleared: string[] }>(`/environments/${encodeURIComponent(name)}/settings`, {
      method: 'DELETE',
      body: '{}',
    }),
  serviceAlias: (name: string, service: string, alias: string) =>
    request<{ host: string; derivedHosts: string[]; port: number }>(
      `/environments/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/alias`,
      { method: 'PUT', body: JSON.stringify({ alias }) },
    ),
  clearServiceAlias: (name: string, service: string) =>
    request<{ ok: boolean; removed: string | null }>(
      `/environments/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/alias`,
      { method: 'DELETE', body: '{}' },
    ),
  serviceOverrides: (name: string, service: string) =>
    request<ServiceOverrides>(
      `/environments/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/overrides`,
    ),
}
