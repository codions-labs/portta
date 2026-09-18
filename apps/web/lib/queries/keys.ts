// Every query key the panel uses, minted here so a component, a mutation and
// the live event stream agree on what a cache entry is called. Keys nest by
// entity, so invalidating `keys.environments()` reaches every environment,
// its git snapshot, its logs and its settings in one call.

export const keys = {
  status: () => ['status'] as const,
  overview: () => ['overview'] as const,
  health: () => ['health'] as const,

  projects: () => ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
  developmentOverview: () => ['overview', 'development'] as const,
  discoveredRepositories: () => ['repositories', 'discovered'] as const,
  repository: (id: string) => ['repositories', id] as const,
  repositoryGit: (id: string) => ['repositories', id, 'git'] as const,
  repositoryCommits: (id: string) => ['repositories', id, 'commits'] as const,
  repositoryInstructions: (id: string) => ['repositories', id, 'instructions'] as const,
  repositoryEnvironments: (id: string) => ['repositories', id, 'environments'] as const,
  activity: (slug: string | null = null, filters: Record<string, string | undefined> = {}) =>
    (slug === null
      ? ['activity', normalise(filters)]
      : ['projects', slug, 'activity', normalise(filters)]) as readonly string[],
  sessions: (slug: string, filters: Record<string, string | undefined> = {}) =>
    ['projects', slug, 'sessions', normalise(filters)] as const,
  session: (id: string) => ['sessions', id] as const,

  environments: () => ['environments'] as const,
  environment: (name: string) => ['environments', name] as const,
  environmentGit: (name: string) => ['environments', name, 'git'] as const,
  environmentServices: (name: string) => ['environments', name, 'services'] as const,
  environmentLogs: (name: string, service: string | null = null) =>
    ['environments', name, 'logs', service ?? ''] as const,
  environmentSettings: (name: string) => ['environments', name, 'settings'] as const,
  environmentRemovalPreview: (name: string) => ['environments', name, 'removal-preview'] as const,
  environmentRebuild: (name: string) => ['environments', name, 'rebuild'] as const,

  services: () => ['services'] as const,
  serviceTraefik: (id: string) => ['services', id, 'traefik'] as const,
  shares: () => ['shares'] as const,

  docker: () => ['docker'] as const,
  dockerHost: () => ['docker', 'host'] as const,
  containers: (filters: Record<string, string | undefined> = {}) =>
    ['docker', 'containers', normalise(filters)] as const,
  containerLogs: (id: string) => ['docker', 'containers', id, 'logs'] as const,
  containerRemovalPreview: (id: string) => ['docker', 'containers', id, 'removal-preview'] as const,

  network: () => ['network'] as const,
  access: () => ['access'] as const,
  connection: (project: string, service: string) => ['access', 'connection', project, service] as const,
  gateway: () => ['gateway'] as const,
  gatewayLogs: (component: string) => ['gateway', 'logs', component] as const,
  apply: () => ['apply'] as const,
  runner: () => ['runner'] as const,

  metrics: () => ['metrics'] as const,
  metricsCurrent: () => ['metrics', 'current'] as const,
  metricsHistory: (window: string) => ['metrics', 'history', window] as const,
  environmentReport: () => ['environment', 'report'] as const,
  hostSecurityReport: () => ['environment', 'security'] as const,
  sshKeys: () => ['ssh', 'keys'] as const,

  // The filters are part of the key: a filtered list is a different answer
  // from the provider, not a subset of one the panel already holds.
  issues: (project: string, filters: Record<string, string | undefined> = {}) => ['issues', project, filters] as const,
  issue: (project: string, ref: string) => ['issues', project, 'one', ref] as const,
  issueRunContext: (project: string, ref: string) => ['issues', project, 'run-context', ref] as const,
  issueVocabulary: (project: string) => ['issues', project, 'vocabulary'] as const,
  forgeStatus: () => ['issues', 'status'] as const,
  config: () => ['config'] as const,
  agentPermissions: () => ['config', 'agent-permissions'] as const,

  users: () => ['users'] as const,
  user: (id: string) => ['users', id] as const,
  userSessions: (id: string) => ['users', id, 'sessions'] as const,
  apiTokens: (all: boolean) => ['tokens', all ? 'all' : 'mine'] as const,
  audit: (filters: Record<string, string | undefined> = {}) => ['audit', normalise(filters)] as const,
}

/** Filters become one stable string, so `{a, b}` and `{b, a}` share a cache entry. */
function normalise(filters: Record<string, string | undefined>): string {
  const entries = Object.entries(filters)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .sort(([left], [right]) => left.localeCompare(right))
  return entries.length === 0 ? '' : JSON.stringify(entries)
}
