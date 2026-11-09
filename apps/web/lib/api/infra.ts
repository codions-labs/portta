// Infrastructure: gateway, Docker, network, access, metrics, settings.

import type {
  AccessView,
  ApplyResult,
  ApplyStatus,
  ConfigDiscardResult,
  ConfigPatchResult,
  ConfigView,
  ContainerSummary,
  CrawlerPolicy,
  CrawlerSettings,
  Diagnostic,
  DockerDiskUsage,
  DockerHost,
  DockerImageList,
  DockerNetworkList,
  DockerPruneBody,
  DockerPruneResult,
  DockerResourceRemoveResult,
  DockerVolumeList,
  EnvironmentReport,
  ExposureResult,
  ExposureView,
  GatewayStatus,
  LogsResponse,
  MetricsCurrent,
  MetricsHistory,
  NetworkView,
  Overview,
  ProjectCrawlers,
  RemovalPreview,
  RunnerStatus,
  SecurityReport,
  ServiceConnection,
  ServiceTraefik,
  Share,
  ShareView,
  TraefikVerdict,
} from 'portta-contracts'
import { request } from './client.ts'

export const infraApi = {
  overview: () => request<Overview>('/status'),
  gateway: () => request<GatewayStatus>('/gateway'),
  doctor: () =>
    request<{ checks: Diagnostic[]; failures: number; warnings: number; ranAt: number; hostCommand: string }>(
      '/gateway/doctor',
      { method: 'POST', body: '{}' },
    ),
  gatewayLogs: (component: string, tail = 200) =>
    request<LogsResponse>(`/gateway/logs?component=${encodeURIComponent(component)}&tail=${tail}`),
  restartGateway: (components: string[]) =>
    request<{ ok: boolean; restarted: string[]; note: string; applyCommand: string }>('/gateway/restart', {
      method: 'POST',
      body: JSON.stringify({ components }),
    }),
  applyStatus: () => request<ApplyStatus>('/gateway/apply'),
  apply: () => request<ApplyResult>('/gateway/apply', { method: 'POST', body: '{}' }),
  runnerStatus: () => request<RunnerStatus>('/runner'),
  // The probes the apply dialog polls with while the panel is being recreated.
  // They take an explicit signal and are deliberately separate from `applyStatus`
  // and `config`: React Query calls a bare `queryFn` with a QueryFunctionContext
  // as its first argument, so a shared function would silently receive that
  // object where it expects an AbortSignal.
  healthProbe: (signal: AbortSignal) =>
    request<{ ok: boolean; panelVersion: string; gatewayVersion: string }>('/health', { signal }),
  applyProbe: (signal: AbortSignal, logs = false) =>
    request<ApplyStatus>(`/gateway/apply${logs ? '?logs=1' : ''}`, { signal }),
  runnerProbe: (signal: AbortSignal, logs = false) =>
    request<RunnerStatus>(`/runner${logs ? '?logs=1' : ''}`, { signal }),
  services: () => request<{ services: ContainerSummary[] }>('/services').then((data) => data.services),
  serviceTraefik: (id: string) => request<ServiceTraefik>(`/services/${encodeURIComponent(id)}/traefik`),
  traefik: () => request<TraefikVerdict>('/gateway/traefik'),
  containers: (params: { ownership?: string; state?: string; q?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.ownership && params.ownership !== 'all') query.set('ownership', params.ownership)
    if (params.state && params.state !== 'all') query.set('state', params.state)
    if (params.q) query.set('q', params.q)
    const suffix = query.toString()
    return request<{ containers: ContainerSummary[]; total: number }>(`/docker/containers${suffix ? `?${suffix}` : ''}`)
  },
  container: (id: string) => request<ContainerSummary>(`/docker/containers/${id}`),
  logs: (id: string, tail = 200) => request<LogsResponse>(`/docker/containers/${id}/logs?tail=${tail}`),
  removalPreview: (id: string) => request<RemovalPreview>(`/docker/containers/${id}/removal-preview`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart') =>
    request<{ ok: boolean; message: string }>(`/docker/containers/${id}/${action}`, {
      method: 'POST',
      body: '{}',
    }),
  removeContainer: (id: string, force: boolean) =>
    request<{ ok: boolean; message: string }>(`/docker/containers/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, force }),
    }),
  host: () => request<DockerHost>('/docker/host'),
  dockerNetworks: () => request<DockerNetworkList>('/docker/networks'),
  dockerImages: () => request<DockerImageList>('/docker/images'),
  dockerVolumes: () => request<DockerVolumeList>('/docker/volumes'),
  dockerUsage: () => request<DockerDiskUsage>('/docker/usage'),
  removeDockerResources: (kind: 'networks' | 'images' | 'volumes', ids: string[]) =>
    request<DockerResourceRemoveResult>(`/docker/${kind}/remove`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true, ids }),
    }),
  pruneDocker: (body: Omit<DockerPruneBody, 'confirm'>) =>
    request<DockerPruneResult>('/docker/prune', { method: 'POST', body: JSON.stringify({ confirm: true, ...body }) }),
  metricsCurrent: () => request<MetricsCurrent>('/metrics/current'),
  environmentReport: () => request<EnvironmentReport>('/environment'),
  hostSecurityReport: () => request<SecurityReport>('/environment/security'),
  metricsHistory: (window = '30m') => request<MetricsHistory>(`/metrics/history?window=${window}`),
  network: () => request<NetworkView>('/network'),
  access: () => request<AccessView>('/access'),
  openBridge: (body: { project: string; service: string; port?: number; ttlSeconds?: number }) =>
    request<{ ok: boolean }>('/access', { method: 'POST', body: JSON.stringify(body) }),
  closeBridge: (id: string) => request<{ ok: boolean }>(`/access/${id}`, { method: 'DELETE' }),
  serviceConnection: (project: string, service: string) =>
    request<ServiceConnection>(
      `/access/services/${encodeURIComponent(project)}/${encodeURIComponent(service)}/connection`,
    ),
  shares: () => request<ShareView>('/shares'),
  createShare: (id: string, body: { mode: 'public' | 'protected'; ttlSeconds?: number }) =>
    request<{ ok: boolean; share: Share; password: string | null }>(`/services/${encodeURIComponent(id)}/share`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  regenerateShare: (id: string) =>
    request<{ ok: boolean; share: Share; password: string | null }>(`/shares/${encodeURIComponent(id)}/regenerate`, {
      method: 'POST',
      body: '{}',
    }),
  exposure: () => request<ExposureView>('/exposure'),
  crawlers: () => request<CrawlerSettings>('/crawlers'),
  setCrawlers: (policy: CrawlerPolicy) =>
    request<CrawlerPolicy>('/crawlers', { method: 'PUT', body: JSON.stringify(policy) }),
  projectCrawlers: (slug: string) => request<ProjectCrawlers>(`/projects/${encodeURIComponent(slug)}/crawlers`),
  setProjectCrawlers: (slug: string, policy: CrawlerPolicy | null) =>
    request<ProjectCrawlers>(`/projects/${encodeURIComponent(slug)}/crawlers`, {
      method: 'PUT',
      body: JSON.stringify({ policy }),
    }),
  protectService: (id: string, body: { user?: string | null; host?: string } = {}) =>
    request<ExposureResult>(`/services/${encodeURIComponent(id)}/exposure`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  openService: (id: string, host?: string) =>
    request<ExposureResult>(`/services/${encodeURIComponent(id)}/exposure/open`, {
      method: 'POST',
      body: JSON.stringify(host ? { host } : {}),
    }),
  closeService: (id: string, host?: string) =>
    request<ExposureResult>(
      `/services/${encodeURIComponent(id)}/exposure${host ? `?host=${encodeURIComponent(host)}` : ''}`,
      { method: 'DELETE' },
    ),
  revokeShare: (id: string) => request<{ ok: boolean }>(`/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  config: () => request<ConfigView>('/config'),
  patchConfig: (values: Record<string, string | null>) =>
    request<ConfigPatchResult>('/config', { method: 'PATCH', body: JSON.stringify({ values }) }),
  discardConfig: (keys?: string[]) =>
    request<ConfigDiscardResult>('/config/discard', {
      method: 'POST',
      body: JSON.stringify(keys ? { keys } : {}),
    }),
}
