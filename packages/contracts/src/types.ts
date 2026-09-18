// The contract between the API and the UI. Zod is the single source of truth:
// every exported type is inferred from the schema that also documents the API.
// Responses are validated in tests, not on the production hot path.

import type { ProjectLocation as CoreProjectLocation } from 'portta-core/browser'
import { TASK_PROVIDERS } from 'portta-core/browser'
import { z } from 'portta-core/zod'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const Ownership = named(
  z.enum(['gateway', 'integrated', 'external', 'standalone']).describe('How the gateway classifies a container'),
  'Ownership',
)
export type Ownership = z.infer<typeof Ownership>

export const ServiceTech = named(
  z
    .object({
      id: z.string().describe('Stable key used to pick an icon, for example postgres, nginx or docker'),
      label: z.string().describe('Short human label shown next to the icon'),
    })
    .strict(),
  'ServiceTech',
)
export type ServiceTech = z.infer<typeof ServiceTech>

export const ContainerState = named(
  z.enum(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']),
  'ContainerState',
)
export type ContainerState = z.infer<typeof ContainerState>

export const Health = named(z.enum(['healthy', 'unhealthy', 'starting', 'none']), 'Health')
export type Health = z.infer<typeof Health>

export const UrlScope = named(
  z.enum(['local', 'vpn', 'public']).describe('Where a routed URL can be reached from'),
  'UrlScope',
)
export type UrlScope = z.infer<typeof UrlScope>

export const EndpointScope = named(
  z.enum(['internal', 'local', 'lan', 'private', 'protected', 'public']).describe('Who can reach an endpoint'),
  'EndpointScope',
)
export type EndpointScope = z.infer<typeof EndpointScope>

export const TcpRouting = named(
  z
    .enum(['starttls-sni', 'tls-sni', 'unsupported', 'unevaluated'])
    .describe('Whether a TCP protocol can be told apart by hostname on a shared port'),
  'TcpRouting',
)
export type TcpRouting = z.infer<typeof TcpRouting>

export const ServiceKind = named(
  z.enum([
    'http',
    'postgres',
    'mysql',
    'redis',
    'mongodb',
    'memcached',
    'search',
    'amqp',
    'clickhouse',
    'smtp',
    'tcp',
    'worker',
  ]),
  'ServiceKind',
)
export type ServiceKind = z.infer<typeof ServiceKind>

export const PublishedPort = named(
  z
    .object({
      ip: z.string(),
      hostPort: z.number().int(),
      containerPort: z.number().int(),
      protocol: z.string(),
    })
    .strict(),
  'PublishedPort',
)
export type PublishedPort = z.infer<typeof PublishedPort>

export const RouteUrl = named(
  z
    .object({
      url: z.string().describe('Absolute URL served by Traefik'),
      host: z.string(),
      scope: UrlScope,
      scheme: z.enum(['http', 'https']),
    })
    .strict(),
  'RouteUrl',
)
export type RouteUrl = z.infer<typeof RouteUrl>

export const MountSummary = named(
  z
    .object({
      type: z.string(),
      name: z.string().nullable(),
      source: z.string(),
      destination: z.string(),
      rw: z.boolean(),
    })
    .strict(),
  'MountSummary',
)
export type MountSummary = z.infer<typeof MountSummary>

/**
 * What the gateway decided about a project, as opposed to what the project
 * declared. Always additive: the derived name and hostname stay where they
 * were, so nothing is ever only-renamed.
 */
export const IssueLinkSource = named(
  z.enum(['manual', 'label', 'branch', 'namespace']).describe('Why this environment is linked to this issue'),
  'IssueLinkSource',
)
export type IssueLinkSource = z.infer<typeof IssueLinkSource>

/**
 * The issue an environment is being worked on, when the panel can tell.
 *
 * A ref and a title, not an embedded issue: rendering a list of environments
 * would otherwise mean one provider call per row, and an environment outlives
 * the provider's availability — the panel can still say what a stack is for
 * when GitHub is unreachable.
 */
export const EnvironmentIssue = named(
  z
    .object({
      ref: z.string().describe('github:owner/repo#113 or linear:ENG-42'),
      label: z.string().describe('The short form a person reads: portta#113, ENG-42'),
      url: z.string().nullable().describe('Where it is on the provider; null when the ref alone cannot say'),
      source: IssueLinkSource,
      reason: z.string().describe('A sentence the UI can show instead of a bare source'),
      panelUrl: z.string().nullable().describe('Where the panel shows it, when a Project claims this environment'),
    })
    .strict(),
  'EnvironmentIssue',
)
export type EnvironmentIssue = z.infer<typeof EnvironmentIssue>

export const EnvironmentOverrides = named(
  z
    .object({
      displayName: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      primaryService: z.string().optional(),
      hiddenServices: z.array(z.string()).optional(),
      serviceOrder: z.array(z.string()).optional(),
    })
    .strict(),
  'EnvironmentOverrides',
)
export type EnvironmentOverrides = z.infer<typeof EnvironmentOverrides>

export const ServiceOverrides = named(
  z
    .object({
      alias: z.string().optional().describe('An additional hostname, routed by Traefik'),
      note: z.string().optional(),
      hidden: z.boolean().optional(),
    })
    .strict(),
  'ServiceOverrides',
)
export type ServiceOverrides = z.infer<typeof ServiceOverrides>

export const ContainerSummary = named(
  z
    .object({
      id: z.string().describe('Docker container id'),
      name: z.string(),
      image: z.string(),
      state: ContainerState,
      status: z.string(),
      health: Health,
      createdAt: unixSeconds,
      startedAt: unixSeconds.nullable(),
      uptimeSeconds: z.number().nullable(),
      ownership: Ownership,
      gatewayComponent: z.string().nullable(),
      environment: z.string().nullable().describe('Environment key (COMPOSE_PROJECT_NAME on this Node)'),
      service: z.string().nullable().describe('Compose service name'),
      workingDir: z.string().nullable(),
      namespace: z.string().nullable(),
      group: z.string().nullable().describe('Optional portta.project logical project label'),
      repo: z.string().nullable().describe('Optional portta.repo label as supplied by the project'),
      repoUrl: z.string().nullable().describe('Repository web address derived from repo'),
      gitRoot: z.string().nullable().describe('Optional portta.git.root label'),
      networks: z.array(z.string()),
      onGatewayNetwork: z.boolean(),
      traefikEnabled: z.boolean(),
      ports: z.array(PublishedPort),
      exposedPorts: z.array(z.number().int()),
      kind: ServiceKind,
      tech: ServiceTech,
      urls: z.array(RouteUrl),
      mounts: z.array(MountSummary),
      labels: z.record(z.string(), z.string()),
      restartCount: z.number().int(),
      exitCode: z.number().int().nullable(),
      oneOff: z
        .boolean()
        .describe('A docker compose run container: it belongs to the environment but is not one of its services'),
      completed: z
        .boolean()
        .describe('Exited 0 with no restart policy: a one-shot that did its job, not a service that is down'),
      overrides: ServiceOverrides.optional().describe('Absent when nothing was overridden'),
    })
    .strict(),
  'ContainerSummary',
)
export type ContainerSummary = z.infer<typeof ContainerSummary>

export const EnvironmentOperable = named(
  z
    .object({
      ok: z.boolean().describe('Whether Compose can be driven for this project from the labels Docker recorded'),
      reason: z.string().nullable().describe('Why it is not operable, when it is not'),
      workingDir: z.string().nullable(),
      configFiles: z.array(z.string()),
    })
    .strict(),
  'EnvironmentOperable',
)
export type EnvironmentOperable = z.infer<typeof EnvironmentOperable>

export const EnvironmentStartable = named(
  z
    .object({
      ok: z.boolean().describe('Whether start can run by iterating the containers that still exist'),
      reason: z.string().nullable(),
      via: z.enum(['iteration', 'runner']).nullable(),
    })
    .strict(),
  'EnvironmentStartable',
)
export type EnvironmentStartable = z.infer<typeof EnvironmentStartable>

export const EnvironmentActionEntry = named(
  z
    .object({
      service: z.string(),
      containerId: z.string(),
      action: z.enum(['start', 'stop']),
      ok: z.boolean(),
      skipped: z.boolean(),
      error: z.string().nullable(),
    })
    .strict(),
  'EnvironmentActionEntry',
)
export type EnvironmentActionEntry = z.infer<typeof EnvironmentActionEntry>

export const EnvironmentActionResult = named(
  z
    .object({
      ok: z.boolean().describe('True only when every requested step succeeded or was skipped'),
      project: z.string(),
      action: z.enum(['start', 'stop', 'restart']),
      requested: z.number().int(),
      succeeded: z.number().int(),
      failed: z.number().int(),
      skipped: z.number().int(),
      results: z.array(EnvironmentActionEntry),
    })
    .strict(),
  'EnvironmentActionResult',
)
export type EnvironmentActionResult = z.infer<typeof EnvironmentActionResult>

export const EnvironmentPorttaRecords = named(
  z
    .object({
      overrides: z.number().int(),
      aliases: z.number().int(),
      projectLinks: z.number().int(),
      issueLinks: z.number().int(),
      accessBridges: z.array(z.string()),
      accessForwarders: z.array(z.string()),
      accessFiles: z.array(z.string()),
    })
    .strict(),
  'EnvironmentPorttaRecords',
)
export type EnvironmentPorttaRecords = z.infer<typeof EnvironmentPorttaRecords>

export const EnvironmentRemovalPreview = named(
  z
    .object({
      environment: z.string(),
      containers: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            service: z.string().nullable(),
            state: ContainerState,
            image: z.string(),
          })
          .strict(),
      ),
      networks: z.array(z.string()),
      volumes: z.array(
        z
          .object({
            name: z.string(),
            sizeBytes: z.number().nullable().describe('Null: the panel has no volume inspect'),
          })
          .strict(),
      ),
      workingDir: z.string().nullable(),
      git: z
        .object({
          collected: z.boolean(),
          dirty: z.boolean(),
          staged: z.number().int(),
          unstaged: z.number().int(),
          untracked: z.number().int(),
        })
        .strict(),
      records: EnvironmentPorttaRecords,
      runnerAvailable: z.boolean(),
      directoryRemovalAvailable: z.boolean(),
    })
    .strict(),
  'EnvironmentRemovalPreview',
)
export type EnvironmentRemovalPreview = z.infer<typeof EnvironmentRemovalPreview>

/** An executable instance of a Project on this Node. Today: one Compose project. */
export const Environment = named(
  z
    .object({
      name: z.string().describe('COMPOSE_PROJECT_NAME; the Environment key on this Node'),
      presence: z
        .enum(['live', 'remembered'])
        .describe(
          'live: it has containers on this Node. remembered: the panel saw it once and kept where it ran; it can be started through the runner, or forgotten',
        ),
      integrated: z.boolean(),
      workingDir: z.string().nullable(),
      operable: EnvironmentOperable.describe('Whether the runner can find this environment on the host'),
      startable: EnvironmentStartable.describe('Whether start can iterate existing containers, or needs the runner'),
      namespace: z.string().nullable(),
      group: z.string().nullable().describe('Optional portta.project label; a hint, not a Project'),
      repo: z.string().nullable(),
      repoUrl: z.string().nullable(),
      gitRoot: z.string().nullable(),
      services: z.array(ContainerSummary),
      serviceCount: z.number().int(),
      runningCount: z.number().int(),
      completedCount: z
        .number()
        .int()
        .optional()
        .describe('Services that exited 0 with no restart policy; they count as fine, not as down'),
      healthyCount: z.number().int(),
      unhealthyCount: z.number().int(),
      networks: z.array(z.string()),
      urls: z.array(RouteUrl),
      scopes: z.array(UrlScope),
      startedAt: unixSeconds.nullable(),
      uptimeSeconds: z.number().nullable(),
      overrides: EnvironmentOverrides.optional().describe('Absent when nothing was overridden'),
      issue: EnvironmentIssue.nullable()
        .optional()
        .describe('The issue this environment is running for, when the panel can tell'),
      location: z.enum(['managed', 'external', 'escaped', 'missing', 'inaccessible']).optional(),
    })
    .strict(),
  'Environment',
)
export type Environment = z.infer<typeof Environment>

export const AdoptionSource = named(
  z.enum(['manual', 'label', 'repo-match', 'path']).describe('Why this environment belongs to this Project'),
  'AdoptionSource',
)
export type AdoptionSource = z.infer<typeof AdoptionSource>

export const AttributionState = named(
  z.enum(['resolved', 'conflict', 'ambiguous', 'unattributed']).describe('How sure the panel is of an association'),
  'AttributionState',
)
export type AttributionState = z.infer<typeof AttributionState>

/**
 * Where a Project sits relative to Projects Home. The vocabulary is the core's
 * (`classifyProjectLocation` in portta-core); the panel, which cannot see the
 * filesystem, only ever answers `managed` or `external` from what is stored.
 */
export const ProjectLocation = named(
  z
    .enum(['managed', 'external', 'escaped', 'missing', 'inaccessible'])
    .describe('Where this Project sits relative to Projects Home'),
  'ProjectLocation',
)
export type ProjectLocation = z.infer<typeof ProjectLocation>
// Compile-time check that the panel's enum is exactly the core's.
const _projectLocations: readonly CoreProjectLocation[] = ProjectLocation.options
void _projectLocations

/**
 * A repository's GitHub coordinate, derived from its remote. Optional metadata
 * on a Repository; it does not define the Repository.
 *
 * Only what the remote itself says. Portta holds no copy of GitHub's view of a
 * repository (private, archived, default branch): `gh` answers those questions
 * when something actually needs them (ADR 0018).
 */
export const ProjectGitHubRepository = named(
  z
    .object({
      slug: z.string().describe('owner/name'),
      htmlUrl: z.string(),
      role: z.string().nullable().describe('api | web | mobile | services | infra | docs | other'),
      position: z.number().int(),
    })
    .strict(),
  'ProjectGitHubRepository',
)
export type ProjectGitHubRepository = z.infer<typeof ProjectGitHubRepository>

export const GitHead = named(
  z
    .object({
      sha: z.string(),
      shortSha: z.string(),
      subject: z.string(),
      author: z.string(),
      date: unixSeconds,
    })
    .strict(),
  'GitHead',
)
export type GitHead = z.infer<typeof GitHead>

export const RepositoryProvider = named(
  z.enum(['local', 'github', 'gitlab', 'bitbucket', 'other']).describe('Where the remote lives, if there is one'),
  'RepositoryProvider',
)
export type RepositoryProvider = z.infer<typeof RepositoryProvider>

export const Commit = named(
  z
    .object({
      sha: z.string(),
      shortSha: z.string(),
      subject: z.string(),
      author: z.string(),
      date: unixSeconds,
      url: z.string().nullable().describe('The commit on the forge, when the remote is one whose shape is known'),
    })
    .strict(),
  'Commit',
)
export type Commit = z.infer<typeof Commit>

/** One file an agent reads before it works, as the host scan found it. */
export const InstructionFile = named(
  z
    .object({
      path: z.string().describe('Relative to the repository root'),
      audience: z.string().describe('any, claude, cursor, copilot, gemini, cline or windsurf'),
      sizeBytes: z.number().int(),
      modifiedAt: unixSeconds,
      sha256: z.string(),
      dirty: z.boolean().describe('True when the working tree differs from HEAD for this file'),
      content: z.string().nullable().describe('Null when the file is over the collection bound'),
      truncated: z.boolean(),
    })
    .strict(),
  'InstructionFile',
)
export type InstructionFile = z.infer<typeof InstructionFile>

/**
 * A reference to one specification document the project keeps — a decision
 * record, an OpenSpec or Spec Kit document — never its content. Where it is,
 * which convention recognised it, what it is called, and the hash and dirty
 * flag that say which version is meant.
 */
export const SpecificationReference = named(
  z
    .object({
      path: z.string().describe('Relative to the repository root'),
      provider: z.string().describe('The convention that recognised it: adr, openspec or spec-kit'),
      kind: z
        .string()
        .describe(
          'What it is within that convention: decision, specification, change, design, tasks, plan, constitution, context, research, data-model or quickstart',
        ),
      title: z.string().nullable().describe('The first heading or front matter title, when there is one'),
      sizeBytes: z.number().int(),
      modifiedAt: unixSeconds,
      sha256: z.string(),
      dirty: z.boolean().describe('True when the working tree differs from HEAD for this file'),
    })
    .strict(),
  'SpecificationReference',
)
export type SpecificationReference = z.infer<typeof SpecificationReference>

/** The compact Git line a list shows for a repository. */
export const RepositoryGitSummary = named(
  z
    .object({
      branch: z.string().nullable(),
      detached: z.boolean(),
      head: GitHead,
      dirty: z.boolean(),
      changed: z.number().int().describe('staged + unstaged + untracked + unmerged'),
      ahead: z.number().int(),
      behind: z.number().int(),
      base: z
        .string()
        .nullable()
        .describe('The upstream ref ahead and behind are measured against, such as origin/main'),
      collectedAt: unixSeconds,
      stale: z.boolean(),
    })
    .strict(),
  'RepositoryGitSummary',
)
export type RepositoryGitSummary = z.infer<typeof RepositoryGitSummary>

/**
 * A repository of a Project: a decision (name, path, remote, role), joined with
 * what the host scan observed about it. GitHub is optional metadata on top.
 */
export const Repository = named(
  z
    .object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      role: z.string().nullable().describe('api | web | mobile | services | infra | docs | other'),
      provider: RepositoryProvider,
      localPath: z.string().nullable().describe('Where it lives on the host, as registered'),
      relativePath: z.string().nullable().describe('Inside the Project, when the Project is managed'),
      remoteUrl: z.string().nullable(),
      position: z.number().int(),
      scanKey: z.string().nullable().describe('The host scan this repository matched, when one did'),
      scanPath: z.string().nullable().describe('The git root the host scanned, when one matched'),
      git: RepositoryGitSummary.nullable(),
      github: ProjectGitHubRepository.nullable(),
      environments: z.array(z.string()).describe('Compose projects running from this repository, per the scan'),
      instructionCount: z.number().int(),
    })
    .strict(),
  'Repository',
)
export type Repository = z.infer<typeof Repository>

/** A git root the host scanned that no Project has registered yet. */
export const DiscoveredRepository = named(
  z
    .object({
      key: z.string(),
      path: z.string(),
      name: z.string(),
      remote: z.string().nullable(),
      location: ProjectLocation.nullable(),
      relativePath: z.string().nullable().describe('One- or two-level path under Projects Home, when managed'),
      environments: z.array(z.string()),
    })
    .strict(),
  'DiscoveredRepository',
)
export type DiscoveredRepository = z.infer<typeof DiscoveredRepository>

export const ProjectEnvironment = named(
  z
    .object({
      environment: z.string().describe('COMPOSE_PROJECT_NAME, the Environment key'),
      source: AdoptionSource,
      attribution: AttributionState.optional(),
      running: z.boolean(),
      serviceCount: z.number().int(),
      runningCount: z.number().int(),
      completedCount: z.number().int().optional().describe('Services that exited 0 with no restart policy'),
      unhealthyCount: z.number().int(),
      urls: z.array(RouteUrl),
    })
    .strict(),
  'ProjectEnvironment',
)
export type ProjectEnvironment = z.infer<typeof ProjectEnvironment>

/** Repeated from work-types.ts rather than imported: that file imports this one. */
const TaskProvider = z.enum(TASK_PROVIDERS)

export const ProjectSummary = named(
  z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      archived: z.boolean(),
      taskProvider: TaskProvider.nullable().describe(
        'Null means derived: GitHub when a repository has a GitHub remote',
      ),
      /** The Linear team, when the provider is Linear. Null otherwise. */
      linearTeam: z.string().nullable(),
      relativePath: z.string().nullable(),
      location: ProjectLocation,
      repositoryCount: z.number().int(),
      environmentCount: z.number().int(),
      runningEnvironmentCount: z.number().int(),
      /**
       * Enough of each adopted environment to act on it from a list: the name to
       * address it by, and what stopping or starting it would do. Without this a
       * project list can only link to a project, never operate one.
       */
      environments: z.array(
        z
          .object({
            name: z.string().describe('COMPOSE_PROJECT_NAME'),
            running: z.boolean(),
            serviceCount: z.number().int(),
            runningCount: z.number().int(),
            unhealthyCount: z.number().int(),
          })
          .strict(),
      ),
    })
    .strict(),
  'ProjectSummary',
)
export type ProjectSummary = z.infer<typeof ProjectSummary>

/** The product the operator recognises. Identity is `id`, not the path. */
export const Project = named(
  z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      archived: z.boolean(),
      taskProvider: TaskProvider.nullable().describe(
        'Null means derived: GitHub when a repository has a GitHub remote',
      ),
      /** The Linear team, when the provider is Linear. GitHub needs no equivalent: its coordinate is the remote. */
      linearTeam: z.string().nullable(),
      /** Where this Project's work actually is, once the provider is resolved. */
      work: z
        .object({
          provider: TaskProvider.nullable(),
          /** `owner/repo` for GitHub, the team key for Linear. Null when nothing is linked. */
          coordinate: z.string().nullable(),
          /** Why there is nothing to read, when there is nothing to read. */
          reason: z.string().nullable(),
        })
        .strict(),
      relativePath: z.string().nullable(),
      resolvedPath: z.string().nullable(),
      location: ProjectLocation,
      repositories: z.array(Repository),
      environments: z.array(ProjectEnvironment),
    })
    .strict(),
  'Project',
)
export type Project = z.infer<typeof Project>

export const GitInfo = named(
  z
    .object({
      branch: z.string().nullable().describe('Null on a detached HEAD'),
      detached: z.boolean(),
      head: GitHead,
      staged: z.number().int(),
      unstaged: z.number().int(),
      untracked: z.number().int(),
      unmerged: z.number().int(),
      dirty: z.boolean(),
      upstream: z.string().nullable(),
      ahead: z.number().int(),
      behind: z.number().int(),
      remote: z.string().nullable().describe('Remote as Git reports it, or the portta.repo label'),
    })
    .strict(),
  'GitInfo',
)
export type GitInfo = z.infer<typeof GitInfo>

export const ForgePullRequest = named(
  z
    .object({
      number: z.number().int(),
      title: z.string(),
      state: z.string(),
      draft: z.boolean(),
      reviewDecision: z.string().nullable(),
      checks: z.string().nullable(),
      url: z.string().nullable(),
      headRefName: z.string().nullable(),
    })
    .strict(),
  'ForgePullRequest',
)
export type ForgePullRequest = z.infer<typeof ForgePullRequest>

export const Forge = named(
  z
    .object({
      kind: z.string(),
      collectedAt: unixSeconds,
      authenticated: z.boolean().describe('False when gh was present but not signed in'),
      reason: z.string().nullable(),
      pulls: z.array(ForgePullRequest),
    })
    .strict(),
  'Forge',
)
export type Forge = z.infer<typeof Forge>

const ProjectRemote = z
  .object({
    url: z.string(),
    host: z.string(),
    slug: z.string(),
    kind: z.string(),
    repoUrl: z.string(),
  })
  .strict()

const ProjectGitLinks = z
  .object({
    repo: z.string().nullable(),
    commit: z.string().nullable(),
    branch: z.string().nullable(),
  })
  .strict()

export const ProjectGit = named(
  z
    .object({
      project: z.string(),
      collected: z.boolean().describe('False when no scan file exists'),
      collectedAt: unixSeconds.nullable(),
      ageSeconds: z.number().nullable(),
      stale: z.boolean(),
      staleAfterSeconds: z.number(),
      workingDir: z.string().nullable(),
      git: GitInfo.nullable(),
      remote: ProjectRemote.nullable(),
      links: ProjectGitLinks,
      forge: Forge.nullable(),
      reason: z.string().nullable().describe('Why Git metadata is absent, when known'),
      refreshCommand: z.string().describe('Exact host command that refreshes this snapshot'),
    })
    .strict()
    .describe('Metadata collected by portta repos scan for one project'),
  'ProjectGit',
)
export type ProjectGit = z.infer<typeof ProjectGit>

/** Everything the host scan collected about one repository. */
export const RepositoryGit = named(
  z
    .object({
      key: z.string(),
      collected: z.boolean().describe('False when no scan file exists for this repository'),
      collectedAt: unixSeconds.nullable(),
      ageSeconds: z.number().nullable(),
      stale: z.boolean(),
      staleAfterSeconds: z.number(),
      path: z.string().nullable().describe('The git root on the host'),
      name: z.string().nullable(),
      git: GitInfo.nullable(),
      remote: ProjectRemote.nullable(),
      links: ProjectGitLinks,
      commits: z.array(Commit).describe('Most recent first, metadata only'),
      instructions: z.array(InstructionFile),
      specifications: z
        .array(SpecificationReference)
        .describe('Decision records and specification documents, as references'),
      environments: z.array(z.string()).describe('Compose projects whose working directory sits under this root'),
      forge: Forge.nullable(),
      reason: z.string().nullable(),
      refreshCommand: z.string(),
    })
    .strict()
    .describe('Collected by portta repos scan for one repository'),
  'RepositoryGit',
)
export type RepositoryGit = z.infer<typeof RepositoryGit>

export const TraefikRouter = named(
  z
    .object({
      name: z.string(),
      rule: z.string(),
      hosts: z.array(z.string()).describe('Every Host rule name, lowercased'),
      entryPoints: z.array(z.string()),
      middlewares: z.array(z.string()),
      service: z.string(),
      provider: z.string(),
      status: z.string().describe('Traefik verdict: enabled, disabled or warning'),
      errors: z.array(z.string()).describe('Traefik error text when it rejected the router'),
      servers: z.array(z.string()).describe('Backends Traefik resolved for this router'),
    })
    .strict(),
  'TraefikRouter',
)
export type TraefikRouter = z.infer<typeof TraefikRouter>

export const TraefikVerdict = named(
  z
    .object({
      available: z.boolean().describe('False when the API is off or unreachable'),
      reason: z.string().nullable(),
      baseUrl: z.string(),
      dashboardUrl: z.string().nullable(),
      routers: z.array(TraefikRouter),
      fetchedAt: unixSeconds,
    })
    .strict(),
  'TraefikVerdict',
)
export type TraefikVerdict = z.infer<typeof TraefikVerdict>

export const ServiceTraefik = named(
  z
    .object({
      containerId: z.string(),
      available: z.boolean(),
      reason: z.string().nullable(),
      expectedHosts: z.array(z.string()).describe('Hostnames derived from labels, for comparison'),
      routers: z.array(TraefikRouter.extend({ dashboardUrl: z.string().nullable() }).strict()),
      fetchedAt: unixSeconds,
    })
    .strict(),
  'ServiceTraefik',
)
export type ServiceTraefik = z.infer<typeof ServiceTraefik>

export const ShareMode = named(z.enum(['public', 'protected']), 'ShareMode')
export type ShareMode = z.infer<typeof ShareMode>

export const ShareState = named(z.enum(['active', 'expired', 'dangling']), 'ShareState')
export type ShareState = z.infer<typeof ShareState>

export const Share = named(
  z
    .object({
      id: z.string(),
      project: z.string(),
      service: z.string(),
      container: z.string().describe('Unique container name used as the Traefik backend'),
      port: z.number().int(),
      host: z.string(),
      url: z.string(),
      mode: ShareMode,
      user: z.string().nullable().describe('Username for a protected share; never a password'),
      createdAt: unixSeconds,
      expiresAt: unixSeconds,
      expiresInSeconds: z.number(),
      state: ShareState,
    })
    .strict(),
  'Share',
)
export type Share = z.infer<typeof Share>

export const ShareView = named(
  z
    .object({
      shares: z.array(Share),
      domain: z.string().describe('Domain reserved for temporary share hostnames'),
      publicAllowed: z.boolean().describe('Whether a public share would be accepted'),
      maxTtlSeconds: z.number().int(),
    })
    .strict(),
  'ShareView',
)
export type ShareView = z.infer<typeof ShareView>

export const Diagnostic = named(
  z
    .object({
      id: z.string(),
      status: z.enum(['pass', 'info', 'warn', 'fail']),
      title: z.string(),
      detail: z.string(),
      fix: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      category: z.enum(['infrastructure', 'development', 'agents', 'security']).optional(),
      details: z
        .array(
          z
            .object({
              status: z.enum(['pass', 'info', 'warn', 'fail']),
              text: z.string(),
            })
            .strict(),
        )
        .optional(),
      tool: z
        .object({
          installed: z.boolean(),
          version: z.string().nullable(),
          path: z.string().nullable(),
          minimum: z.string().optional(),
          recommended: z.string().optional(),
        })
        .strict()
        .optional(),
      rationale: z.string().optional(),
      docs: z.string().optional(),
    })
    .strict(),
  'Diagnostic',
)
export type Diagnostic = z.infer<typeof Diagnostic>
/** The host-readiness spelling; kept structurally compatible with diagnostics. */
export const EnvironmentCheck = Diagnostic
export type EnvironmentCheck = z.infer<typeof EnvironmentCheck>

const EnvironmentReportShape = z
  .object({
    version: z.literal(1),
    collectedAt: unixSeconds.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    ageSeconds: z.number().int().nonnegative().nullable(),
    stale: z.boolean(),
    checks: z.array(EnvironmentCheck),
    summary: z
      .object({
        passed: z.number().int().nonnegative(),
        recommendations: z.number().int().nonnegative(),
        problems: z.number().int().nonnegative(),
        information: z.number().int().nonnegative(),
        ok: z.boolean(),
      })
      .strict(),
  })
  .strict()

export const EnvironmentReport = named(EnvironmentReportShape, 'EnvironmentReport')
export type EnvironmentReport = z.infer<typeof EnvironmentReport>

export const SecurityReport = named(EnvironmentReportShape, 'SecurityReport')
export type SecurityReport = z.infer<typeof SecurityReport>

const GatewayTls = z.object({ enabled: z.boolean(), mode: z.string() }).strict()
const GatewayTailscale = z.object({ enabled: z.boolean(), running: z.boolean(), hostname: z.string() }).strict()
const GatewayPublicAccess = z.object({ enabled: z.boolean(), domain: z.string().nullable() }).strict()
const GatewayPanel = z
  .object({
    expose: z.string(),
    routed: z.boolean(),
    /** `disabled` or `required`: whether the panel asks who you are. */
    auth: z.string(),
    authenticated: z.boolean(),
    readOnly: z.boolean(),
    /** Whether this panel serves the documentation, so the UI never links to a 404. */
    docs: z.boolean(),
  })
  .strict()
const GatewayDashboard = z
  .object({
    enabled: z.boolean(),
    bindAddress: z.string(),
    port: z.string(),
    expose: z.literal('local'),
    advertisedHost: z.string().nullable(),
    authenticated: z.boolean(),
    endpoints: z.array(
      z
        .object({
          provider: z.string(),
          url: z.string(),
          scope: EndpointScope,
          usable: z.boolean(),
          shareable: z.boolean(),
          problem: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
const GatewayComponent = z
  .object({
    containerId: z.string().nullable(),
    state: ContainerState.or(z.literal('absent')),
    health: Health,
  })
  .strict()
const GatewaySocketProxy = z
  .object({
    containerId: z.string().nullable(),
    state: ContainerState.or(z.literal('absent')),
  })
  .strict()
const GatewayNetwork = z
  .object({
    name: z.string(),
    exists: z.boolean(),
    attached: z.number().int(),
    internal: z.boolean(),
  })
  .strict()

export const GatewayStatus = named(
  z
    .object({
      gatewayVersion: z.string(),
      panelVersion: z.string(),
      profile: z.string(),
      domain: z.string(),
      privateDomain: z.string().nullable(),
      publicDomain: z.string().nullable(),
      bindAddress: z.string(),
      httpPort: z.string(),
      httpsPort: z.string(),
      scheme: z.enum(['http', 'https']),
      up: z.boolean(),
      reachable: z.boolean(),
      tls: GatewayTls,
      tailscale: GatewayTailscale,
      publicAccess: GatewayPublicAccess,
      panel: GatewayPanel.describe('Panel exposure and authentication without the secret hash'),
      dashboard: GatewayDashboard,
      traefik: GatewayComponent,
      socketProxy: GatewaySocketProxy,
      database: GatewayComponent,
      network: GatewayNetwork,
      routes: z.number().int(),
    })
    .strict(),
  'GatewayStatus',
)
export type GatewayStatus = z.infer<typeof GatewayStatus>

const nullableNumber = z.number().nullable()
const nullableString = z.string().nullable()

const HostLoad = z
  .object({
    one: z.number(),
    five: z.number(),
    fifteen: z.number(),
  })
  .strict()

export const HostCpuInfo = named(
  z
    .object({
      manufacturer: nullableString,
      brand: nullableString,
      physicalCores: z.number().int().nullable(),
      logicalCores: z.number().int().nullable(),
      speed: nullableNumber,
      speedMax: nullableNumber,
    })
    .strict(),
  'HostCpuInfo',
)
export type HostCpuInfo = z.infer<typeof HostCpuInfo>

export const HostGpuInfo = named(
  z
    .object({
      vendor: nullableString,
      model: z.string(),
      vramBytes: nullableNumber,
      utilisation: nullableNumber,
      temperature: nullableNumber,
    })
    .strict(),
  'HostGpuInfo',
)
export type HostGpuInfo = z.infer<typeof HostGpuInfo>

export const HostBatteryInfo = named(
  z
    .object({
      hasBattery: z.literal(true),
      percent: nullableNumber.describe('0-1'),
      charging: z.boolean(),
      acConnected: z.boolean(),
      minutesRemaining: z.number().int().nullable(),
      cycleCount: z.number().int().nullable(),
    })
    .strict(),
  'HostBatteryInfo',
)
export type HostBatteryInfo = z.infer<typeof HostBatteryInfo>

export const HostStorageInfo = named(
  z
    .object({
      path: z.string(),
      mount: nullableString,
      filesystem: nullableString,
      totalBytes: z.number(),
      usedBytes: z.number(),
      availableBytes: z.number(),
      usedPercent: z.number(),
    })
    .strict(),
  'HostStorageInfo',
)
export type HostStorageInfo = z.infer<typeof HostStorageInfo>

export const HostKind = z.enum(['notebook', 'desktop', 'server', 'vm'])
export type HostKind = z.infer<typeof HostKind>

export const HostMetrics = named(
  z
    .object({
      hostname: nullableString,
      manufacturer: nullableString,
      model: nullableString,
      productName: nullableString.describe(
        'The commercial name, where the platform reports a trustworthy one (macOS so far)',
      ),
      kind: HostKind.nullable().describe(
        'What the machine is, from its chassis, hypervisor flag and battery; null when none of them say',
      ),
      architecture: nullableString,
      virtual: z.boolean().nullable(),
      platform: nullableString,
      distro: nullableString,
      version: nullableString,
      release: nullableString,
      kernel: nullableString,
      uptimeSeconds: nullableNumber,
      cpu: HostCpuInfo,
      memoryTotalBytes: nullableNumber,
      memoryUsedBytes: nullableNumber,
      memoryAvailableBytes: nullableNumber,
      memoryUsedPercent: nullableNumber,
      swapTotalBytes: nullableNumber,
      swapUsedBytes: nullableNumber,
      cpuUtilisation: nullableNumber,
      cpuIdle: nullableNumber,
      load: HostLoad.nullable(),
      storage: HostStorageInfo.nullable(),
      gpu: z.array(HostGpuInfo),
      temperatureCelsius: nullableNumber.describe('CPU package temperature in Celsius, where the platform reports one'),
      battery: HostBatteryInfo.nullable().describe('Absent on a host with no battery'),
    })
    .strict(),
  'HostMetrics',
)
export type HostMetrics = z.infer<typeof HostMetrics>

export const ContainerResourceMetrics = named(
  z
    .object({
      id: z.string(),
      name: z.string(),
      service: nullableString,
      cpuUtilisation: nullableNumber,
      memoryUsedBytes: nullableNumber,
      memoryLimitBytes: nullableNumber,
      memoryUsedPercent: nullableNumber,
      networkRxBytes: nullableNumber,
      networkTxBytes: nullableNumber,
      blockReadBytes: nullableNumber,
      blockWriteBytes: nullableNumber,
      pids: z.number().int().nullable(),
    })
    .strict(),
  'ContainerResourceMetrics',
)
export type ContainerResourceMetrics = z.infer<typeof ContainerResourceMetrics>

export const ProjectResourceMetrics = named(
  z
    .object({
      id: z.string(),
      name: z.string(),
      composeProject: z.string(),
      cpuUtilisation: nullableNumber,
      memoryUsedBytes: nullableNumber,
      containerCount: z.number().int(),
      networkRxBytes: nullableNumber,
      networkTxBytes: nullableNumber,
      containers: z.array(ContainerResourceMetrics),
    })
    .strict(),
  'ProjectResourceMetrics',
)
export type ProjectResourceMetrics = z.infer<typeof ProjectResourceMetrics>

export const MetricsInstance = named(
  z
    .object({
      id: z.string(),
      name: nullableString,
      hostname: nullableString,
    })
    .strict(),
  'MetricsInstance',
)
export type MetricsInstance = z.infer<typeof MetricsInstance>

export const RuntimeHint = named(
  z
    .object({
      name: z.enum(['orbstack', 'docker-desktop', 'docker-engine', 'unknown']),
    })
    .strict(),
  'RuntimeHint',
)
export type RuntimeHint = z.infer<typeof RuntimeHint>

export const MetricsCurrent = named(
  z
    .object({
      version: z.literal(1),
      instance: MetricsInstance,
      collectedAt: unixSeconds.nullable(),
      ageSeconds: z.number().int().nullable(),
      stale: z.boolean(),
      collectorActive: z.boolean(),
      host: HostMetrics.nullable(),
      runtime: RuntimeHint.nullable(),
      projects: z.array(ProjectResourceMetrics),
    })
    .strict(),
  'MetricsCurrent',
)
export type MetricsCurrent = z.infer<typeof MetricsCurrent>

export const MetricsHistoryPoint = named(
  z
    .object({
      timestamp: unixSeconds,
      host: z
        .object({
          cpuUtilisation: nullableNumber,
          memoryUsedBytes: nullableNumber,
          memoryUsedPercent: nullableNumber,
          storageUsedPercent: nullableNumber,
          load: HostLoad.nullable(),
          gpuUtilisation: nullableNumber,
          temperatureCelsius: nullableNumber,
        })
        .strict(),
      projects: z.array(
        z
          .object({
            id: z.string(),
            cpuUtilisation: nullableNumber,
            memoryUsedBytes: nullableNumber,
          })
          .strict(),
      ),
      containers: z.array(
        z
          .object({
            id: z.string(),
            cpuUtilisation: nullableNumber,
            memoryUsedBytes: nullableNumber,
          })
          .strict(),
      ),
    })
    .strict(),
  'MetricsHistoryPoint',
)
export type MetricsHistoryPoint = z.infer<typeof MetricsHistoryPoint>

export const MetricsHistory = named(
  z
    .object({
      windowSeconds: z.number().int(),
      points: z.array(MetricsHistoryPoint),
    })
    .strict(),
  'MetricsHistory',
)
export type MetricsHistory = z.infer<typeof MetricsHistory>

export const OverviewCounts = named(
  z
    .object({
      projects: z.number().int(),
      integratedProjects: z.number().int(),
      services: z.number().int(),
      servicesRunning: z.number().int(),
      servicesHealthy: z.number().int(),
      servicesUnhealthy: z.number().int(),
      containersTotal: z.number().int(),
      containersRunning: z.number().int(),
      containersGateway: z.number().int(),
      containersIntegrated: z.number().int(),
      containersExternal: z.number().int(),
      containersStandalone: z.number().int(),
      bridges: z.number().int(),
      forwarders: z.number().int(),
      routes: z.number().int(),
      shares: z.number().int(),
      sharesStale: z.number().int().describe('Shares that expired or whose target is gone'),
    })
    .strict(),
  'OverviewCounts',
)
export type OverviewCounts = z.infer<typeof OverviewCounts>

/**
 * Whether this installation can read and write issues, and what is missing.
 *
 * Never a token and never a key: `gh` holds GitHub's credential on the host and
 * Linear's is an environment variable there. What the panel is allowed to say
 * is whether the tool exists, whether somebody is signed in, and as whom — so
 * the screen can name the one command that fixes it.
 */
export const ProviderStatus = named(
  z
    .object({
      available: z.boolean().describe('The tool or key exists on the host at all'),
      authenticated: z.boolean(),
      account: z.string().nullable().describe('Who the host is signed in as'),
      reason: z.string().nullable().describe('Why not, when it is not'),
    })
    .strict(),
  'ProviderStatus',
)
export type ProviderStatus = z.infer<typeof ProviderStatus>

export const ForgeStatus = named(
  z
    .object({
      github: ProviderStatus,
      linear: ProviderStatus,
    })
    .strict(),
  'ForgeStatus',
)
export type ForgeStatus = z.infer<typeof ForgeStatus>

export const Overview = named(
  z
    .object({
      gateway: GatewayStatus,
      counts: OverviewCounts,
      urls: z.array(RouteUrl),
      problems: z.array(Diagnostic),
      generatedAt: unixSeconds,
      forge: ForgeStatus.optional().describe('Absent on a panel built before work moved to an external provider'),
    })
    .strict(),
  'Overview',
)
export type Overview = z.infer<typeof Overview>

export const NetworkSummary = named(
  z
    .object({
      id: z.string(),
      name: z.string(),
      driver: z.string(),
      scope: z.string(),
      internal: z.boolean(),
      containerCount: z.number().int(),
      managed: z.boolean(),
      role: z.enum(['shared', 'control', 'access', 'project', 'other']),
    })
    .strict(),
  'NetworkSummary',
)
export type NetworkSummary = z.infer<typeof NetworkSummary>

const PortBinding = z
  .object({
    ip: z.string(),
    containerId: z.string(),
    containerName: z.string(),
    ownership: Ownership,
    containerPort: z.number().int(),
  })
  .strict()

export const PortUsage = named(
  z
    .object({
      hostPort: z.number().int(),
      protocol: z.string(),
      bindings: z.array(PortBinding),
      conflict: z.boolean(),
    })
    .strict(),
  'PortUsage',
)
export type PortUsage = z.infer<typeof PortUsage>

export const DockerHost = named(
  z
    .object({
      engine: z
        .object({
          version: z.string(),
          apiVersion: z.string(),
          os: z.string(),
          arch: z.string(),
          cpus: z.number().int(),
          memoryBytes: z.number(),
          name: z.string(),
        })
        .strict(),
      containers: z
        .object({
          total: z.number().int(),
          running: z.number().int(),
          paused: z.number().int(),
          stopped: z.number().int(),
        })
        .strict(),
      byOwnership: z
        .object({
          gateway: z.number().int(),
          integrated: z.number().int(),
          external: z.number().int(),
          standalone: z.number().int(),
        })
        .strict(),
      networks: z.array(NetworkSummary),
      ports: z.array(PortUsage),
    })
    .strict(),
  'DockerHost',
)
export type DockerHost = z.infer<typeof DockerHost>

export const Bridge = named(
  z
    .object({
      id: z.string(),
      containerId: z.string(),
      project: z.string(),
      service: z.string(),
      targetPort: z.number().int(),
      localPort: z.number().int().nullable(),
      bindIp: z.string(),
      kind: ServiceKind,
      network: z.string(),
      createdAt: unixSeconds.nullable(),
      expiresAt: unixSeconds.nullable(),
      state: ContainerState.or(z.literal('absent')),
      connectionString: z.string(),
    })
    .strict(),
  'Bridge',
)
export type Bridge = z.infer<typeof Bridge>

export const Forwarder = named(
  z
    .object({
      alias: z.string(),
      containerId: z.string(),
      project: z.string(),
      service: z.string(),
      port: z.number().int(),
      kind: ServiceKind,
      state: ContainerState.or(z.literal('absent')),
      networks: z.array(z.string()),
    })
    .strict(),
  'Forwarder',
)
export type Forwarder = z.infer<typeof Forwarder>

export const TcpService = named(
  z
    .object({
      containerId: z.string(),
      project: z.string(),
      service: z.string(),
      image: z.string(),
      kind: ServiceKind,
      tech: ServiceTech,
      state: ContainerState,
      health: Health,
      ports: z.array(z.number().int()),
      defaultPort: z.number().int().nullable(),
      publishedPorts: z.array(PublishedPort),
      privateNetworks: z.array(z.string()),
      bridge: Bridge.nullable(),
      forwarder: Forwarder.nullable(),
      integrated: z.boolean(),
      routing: TcpRouting.describe('How this protocol can be routed by hostname'),
      routed: z.boolean().describe('Whether the container opted into a TCP router'),
      gatewayAddress: z.string().nullable(),
      gatewayConnectionString: z.string().nullable(),
    })
    .strict(),
  'TcpService',
)

export const ServiceEndpoint = named(
  z
    .object({
      provider: z.string(),
      url: z.string(),
      scope: EndpointScope,
      usable: z.boolean(),
      shareable: z.boolean(),
      problem: z.string().nullable(),
      connectionString: z.string(),
    })
    .strict(),
  'ServiceEndpoint',
)
export type ServiceEndpoint = z.infer<typeof ServiceEndpoint>

export const ServiceConnection = named(
  z
    .object({
      project: z.string(),
      service: z.string(),
      kind: ServiceKind,
      endpoints: z.array(ServiceEndpoint),
      credentials: z
        .object({
          discovered: z.boolean(),
          user: z.string().nullable(),
          password: z.string().nullable().describe('Present only on this route; never logged or stored'),
          database: z.string().nullable(),
          source: z.string().nullable(),
          reason: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  'ServiceConnection',
)
export type ServiceConnection = z.infer<typeof ServiceConnection>
export type TcpService = z.infer<typeof TcpService>

export const AccessView = named(
  z
    .object({
      services: z.array(TcpService),
      bridges: z.array(Bridge),
      forwarders: z.array(Forwarder),
      bridgeImageHint: z.string(),
      tcpRoutingEnabled: z.boolean().describe('Whether TCP entrypoints are currently published'),
    })
    .strict(),
  'AccessView',
)
export type AccessView = z.infer<typeof AccessView>

const NetworkRoute = z
  .object({
    project: z.string().nullable(),
    service: z.string().nullable(),
    containerId: z.string(),
    containerName: z.string(),
    state: ContainerState,
    urls: z.array(RouteUrl),
    port: z.string(),
  })
  .strict()

export const NetworkView = named(
  z
    .object({
      gateway: GatewayStatus,
      domains: z
        .object({
          local: z.string(),
          private: z.string().nullable(),
          public: z.string().nullable(),
          scheme: z.enum(['http', 'https']),
        })
        .strict(),
      routes: z.array(NetworkRoute),
      networks: z.array(NetworkSummary),
      tailscale: z
        .object({
          enabled: z.boolean(),
          running: z.boolean(),
          hostname: z.string(),
          state: ContainerState.or(z.literal('absent')),
          health: Health,
        })
        .strict(),
      dns: z
        .object({
          provider: z.string(),
          cloudflareEnabled: z.boolean(),
          zone: z.string().nullable(),
        })
        .strict(),
      tls: z
        .object({
          enabled: z.boolean(),
          mode: z.string(),
          acmeEmailSet: z.boolean(),
          caServer: z.string(),
        })
        .strict(),
    })
    .strict(),
  'NetworkView',
)
export type NetworkView = z.infer<typeof NetworkView>

export const ConfigField = named(
  z
    .object({
      key: z.string(),
      value: z.string().nullable().describe('Never populated for a secret'),
      runtimeValue: z.string().nullable(),
      effectiveValue: z
        .string()
        .nullable()
        .describe('Value the form should display after applying precedence and defaults'),
      defaultValue: z.string().nullable().describe('Canonical default when the key is absent from .env'),
      valueSource: z
        .enum(['saved', 'default', 'detected', 'derived', 'environment'])
        .optional()
        .describe('Where the displayed value comes from, when that is useful to say'),
      secret: z.boolean(),
      isSet: z.boolean(),
      pending: z.boolean().describe('Saved value differs from the running process'),
      kind: z.enum(['boolean', 'string', 'number', 'choice']),
      choices: z.array(z.string()).optional(),
      group: z.string(),
      label: z.string(),
      help: z.string(),
      restartRequired: z.boolean(),
    })
    .strict(),
  'ConfigField',
)
export type ConfigField = z.infer<typeof ConfigField>

/**
 * What the chosen domain mode actually produces, resolved on the server so the
 * settings page shows the hostname a project will get rather than the raw
 * variables it was assembled from.
 */
export const ProjectDomain = named(
  z
    .object({
      mode: z.enum(['local', 'auto', 'custom']),
      domain: z.string().describe('The base every project hostname is built on'),
      publicIp: z.string().nullable(),
      provider: z.string(),
      examples: z.array(z.string()).describe('Hostnames a project would get'),
      problem: z.string().nullable().describe('Set when the mode could not be honoured'),
      reachable: z.boolean().describe('Whether Traefik listens somewhere these names can actually reach it'),
      advice: z.string().nullable().describe('What to do about it, when something is off'),
    })
    .strict(),
  'ProjectDomain',
)
export type ProjectDomain = z.infer<typeof ProjectDomain>

export const TunnelRoute = named(
  z
    .object({
      hostname: z.string(),
      service: z.string(),
    })
    .strict(),
  'TunnelRoute',
)
export type TunnelRoute = z.infer<typeof TunnelRoute>

export const TunnelView = named(
  z
    .object({
      state: z
        .enum(['not-configured', 'configured', 'starting', 'connected', 'disconnected', 'auth-error', 'config-error'])
        .describe('What the connector is doing, distinguished so the fix is obvious'),
      detail: z.string(),
      hint: z.string().nullable().describe('The single next step, when there is one'),
      enabled: z.boolean().describe('Whether the connector is part of the running stack'),
      zone: z.string().nullable().describe('The domain whose wildcard reaches this gateway'),
      wildcard: z.string().nullable(),
      tunnelId: z
        .string()
        .nullable()
        .describe('Not a secret: cfargotunnel only accepts records from the owning account'),
      // Never the token itself, in any state. The panel says whether one exists.
      credentialConfigured: z.boolean(),
      container: z.object({
        name: z.string(),
        state: z.string(),
        health: z.string(),
      }),
      routes: z.array(TunnelRoute).describe('What the connector serves, in match order'),
      endpointCount: z.number().describe('HTTP services this tunnel could publish'),
      dnsRecord: z
        .object({ type: z.string(), name: z.string(), target: z.string(), proxied: z.boolean() })
        .nullable()
        .describe('The one record the operator creates by hand, once'),
      imageAvailable: z.boolean().describe('Whether the connector image is already pulled'),
    })
    .strict(),
  'TunnelView',
)
export type TunnelView = z.infer<typeof TunnelView>

export const ConfigView = named(
  z
    .object({
      fields: z.array(ConfigField),
      projectDomain: ProjectDomain,
      envFile: z.object({ path: z.string(), exists: z.boolean(), writable: z.boolean() }).strict(),
      pendingRestart: z.boolean(),
      applyCommand: z.string().describe('Host command that applies saved changes'),
      groups: z.array(z.string()),
    })
    .strict(),
  'ConfigView',
)
export type ConfigView = z.infer<typeof ConfigView>

export const ConfigPatchResult = named(
  z
    .object({
      ok: z.boolean(),
      saved: z.array(z.string()),
      pendingRestart: z.boolean(),
      applyCommand: z.string(),
      view: ConfigView,
    })
    .strict(),
  'ConfigPatchResult',
)
export type ConfigPatchResult = z.infer<typeof ConfigPatchResult>

/**
 * A saved setting that the running gateway has not picked up. Values are
 * omitted for secrets; `fromSet` / `toSet` still say whether one was present.
 */
export const PendingChange = named(
  z
    .object({
      key: z.string(),
      label: z.string(),
      group: z.string(),
      from: z.string().nullable().describe('Running value; null for a secret'),
      to: z.string().nullable().describe('Saved value; null for a secret'),
      secret: z.boolean(),
      fromSet: z.boolean().describe('Whether the running process had a value'),
      toSet: z.boolean().describe('Whether the saved file has a value'),
      restartRequired: z.boolean(),
    })
    .strict(),
  'PendingChange',
)
export type PendingChange = z.infer<typeof PendingChange>

export const ConfigDiscardResult = named(
  z
    .object({
      ok: z.boolean(),
      discarded: z.array(z.string()),
      pendingRestart: z.boolean(),
      applyCommand: z.string(),
      view: ConfigView,
    })
    .strict(),
  'ConfigDiscardResult',
)
export type ConfigDiscardResult = z.infer<typeof ConfigDiscardResult>

/**
 * Applying is a container the gateway created stopped, which the panel may
 * start. Every field is derived from that container rather than remembered in
 * this process, because the apply recreates this process. See ADR 0026.
 */
export const ApplyState = named(z.enum(['unavailable', 'idle', 'running', 'ok', 'failed']), 'ApplyState')
export type ApplyState = z.infer<typeof ApplyState>

/**
 * Why there is no applier, as a value the UI can translate rather than a
 * sentence it can only print. The three cases have three different fixes, and
 * telling an operator to set a key that is already set sends them to the wrong
 * file: `disabled` is a setting, `not-prepared` is a command, and `refused` is
 * a posture this host deliberately took.
 */
export const ApplyUnavailableReason = named(z.enum(['disabled', 'refused', 'not-prepared']), 'ApplyUnavailableReason')
export type ApplyUnavailableReason = z.infer<typeof ApplyUnavailableReason>

export const ApplyStatus = named(
  z
    .object({
      state: ApplyState,
      available: z.boolean().describe('An applier container exists on this host'),
      reason: z.string().nullable().describe('Why the panel cannot apply, in one line'),
      // The same fact as `reason`, as a case the UI can translate. Null whenever
      // an applier exists, which is exactly when `reason` is null too.
      unavailableReason: ApplyUnavailableReason.nullable(),
      // This host builds its own images, so an apply carries a Docker build in
      // front of it. On a first run that is minutes, not seconds — long enough
      // that a progress dialog which does not say so reads as a hang.
      buildsImages: z.boolean(),
      startedAt: unixSeconds.nullable(),
      finishedAt: unixSeconds.nullable(),
      exitCode: z.number().int().nullable(),
      // Repeated from ConfigView deliberately: while the panel is being recreated
      // every extra request is another chance to fail, so one poll has to answer
      // both "has it finished?" and "did it take?".
      pendingRestart: z.boolean(),
      // Keys whose saved value is not running yet, so the confirmation can say
      // what is about to change rather than asking for blind trust.
      pendingKeys: z.array(z.string()),
      pendingChanges: z.array(PendingChange),
      // A pending key that moves the panel's own address: this tab will not
      // reconnect on its own, and saying so is the difference between a wait and
      // a hang.
      movesPanel: z.boolean(),
      logTail: z.array(z.string()),
      profile: z.string(),
      applyCommand: z.string().describe('Host command that applies saved changes'),
    })
    .strict(),
  'ApplyStatus',
)
export type ApplyStatus = z.infer<typeof ApplyStatus>

export const RunnerState = named(z.enum(['unavailable', 'idle', 'running', 'ok', 'failed']), 'RunnerState')
export type RunnerState = z.infer<typeof RunnerState>

export const RunnerUnavailableReason = named(z.enum(['disabled', 'refused', 'not-prepared']), 'RunnerUnavailableReason')
export type RunnerUnavailableReason = z.infer<typeof RunnerUnavailableReason>

export const RunnerStatus = named(
  z
    .object({
      state: RunnerState,
      available: z.boolean().describe('A runner container exists on this host'),
      reason: z.string().nullable().describe('Why the panel cannot operate a project, in one line'),
      unavailableReason: RunnerUnavailableReason.nullable(),
      startedAt: unixSeconds.nullable(),
      finishedAt: unixSeconds.nullable(),
      exitCode: z.number().int().nullable(),
      logTail: z.array(z.string()),
      prepareCommand: z.string().describe('Host command that prepares the runner'),
    })
    .strict(),
  'RunnerStatus',
)
export type RunnerStatus = z.infer<typeof RunnerStatus>

export const ProjectRebuildResult = named(
  z
    .object({
      ok: z.boolean(),
      project: z.string(),
      noCache: z.boolean(),
      via: z.literal('runner'),
      runner: RunnerStatus,
    })
    .strict(),
  'ProjectRebuildResult',
)
export type ProjectRebuildResult = z.infer<typeof ProjectRebuildResult>

/** A start that could not iterate containers, because none exist: the runner ran Compose `up` instead. */
export const EnvironmentRunnerStartResult = named(
  z
    .object({
      ok: z.boolean(),
      project: z.string(),
      action: z.literal('start'),
      via: z.literal('runner'),
      runner: RunnerStatus,
    })
    .strict(),
  'EnvironmentRunnerStartResult',
)
export type EnvironmentRunnerStartResult = z.infer<typeof EnvironmentRunnerStartResult>

export const ProjectRemoveResult = named(
  z
    .object({
      ok: z.boolean(),
      project: z.string(),
      mode: z.enum(['keep-data', 'and-local-data']),
      volumes: z.boolean(),
      directory: z.boolean(),
      via: z.enum(['runner', 'iteration']),
      removedContainers: z.array(z.string()),
      cleaned: EnvironmentPorttaRecords,
      remainingCommands: z.array(z.string()),
      runner: RunnerStatus.nullable(),
      note: z.string().nullable(),
    })
    .strict(),
  'ProjectRemoveResult',
)
export type ProjectRemoveResult = z.infer<typeof ProjectRemoveResult>

export const ApplyResult = named(
  z
    .object({
      ok: z.literal(true),
      startedAt: unixSeconds,
      note: z.string(),
      applyCommand: z.string(),
    })
    .strict(),
  'ApplyResult',
)
export type ApplyResult = z.infer<typeof ApplyResult>

const LogLine = z
  .object({
    stream: z.enum(['stdout', 'stderr']),
    timestamp: z.string().nullable(),
    text: z.string(),
  })
  .strict()

export const LogsResponse = named(
  z
    .object({
      containerId: z.string(),
      name: z.string(),
      lines: z.array(LogLine),
      truncated: z.boolean(),
    })
    .strict(),
  'LogsResponse',
)
export type LogsResponse = z.infer<typeof LogsResponse>

/** One service of a project, and whether its output could be read. */
export const ProjectLogSource = named(
  z
    .object({
      containerId: z.string(),
      service: z.string().describe('Compose service name, or the container name when unlabelled'),
      name: z.string().describe('Container name'),
      state: ContainerState,
      lineCount: z.number().int(),
      truncated: z.boolean(),
      error: z.string().nullable().describe('Why this source contributed no lines'),
    })
    .strict(),
  'ProjectLogSource',
)
export type ProjectLogSource = z.infer<typeof ProjectLogSource>

export const ProjectLogLine = named(
  z
    .object({
      stream: z.enum(['stdout', 'stderr']),
      timestamp: z.string().nullable(),
      text: z.string(),
      service: z.string().describe('Which source produced this line'),
    })
    .strict(),
  'ProjectLogLine',
)
export type ProjectLogLine = z.infer<typeof ProjectLogLine>

export const ProjectLogsResponse = named(
  z
    .object({
      project: z.string(),
      sources: z.array(ProjectLogSource),
      lines: z.array(ProjectLogLine).describe('Merged and ordered by timestamp where one exists'),
      truncated: z.boolean(),
      ordered: z.boolean().describe('False when a source logged without timestamps, so ordering is approximate'),
    })
    .strict(),
  'ProjectLogsResponse',
)
export type ProjectLogsResponse = z.infer<typeof ProjectLogsResponse>

export const ActionResult = named(
  z.object({ ok: z.boolean(), action: z.string(), containerId: z.string(), message: z.string() }).strict(),
  'ActionResult',
)
export type ActionResult = z.infer<typeof ActionResult>

export const RemovalPreview = named(
  z
    .object({
      containerId: z.string(),
      name: z.string(),
      image: z.string(),
      ownership: Ownership,
      state: ContainerState,
      project: z.string().nullable(),
      mounts: z.array(MountSummary),
      namedVolumes: z.array(z.string()),
      networks: z.array(z.string()),
      warnings: z.array(z.string()),
      allowed: z.boolean(),
    })
    .strict(),
  'RemovalPreview',
)
export type RemovalPreview = z.infer<typeof RemovalPreview>

export const LiveEventKind = named(
  z.enum([
    'container',
    'network',
    'bridge',
    'health',
    'project',
    'config',
    'hello',
    'session',
    'activity',
    'repository',
  ]),
  'LiveEventKind',
)
export type LiveEventKind = z.infer<typeof LiveEventKind>

export const LiveEvent = named(
  z
    .object({
      kind: LiveEventKind,
      action: z.string(),
      id: z.string().nullable(),
      name: z.string().nullable(),
      project: z.string().nullable(),
      ownership: Ownership.nullable(),
      at: unixSeconds,
    })
    .strict(),
  'LiveEvent',
)
export type LiveEvent = z.infer<typeof LiveEvent>

export const DatabaseMigrateResult = named(
  z
    .object({
      applied: z.array(z.string()).describe('Filenames this call applied'),
      migrations: z.array(z.string()).describe('Every migration the panel has applied'),
    })
    .strict(),
  'DatabaseMigrateResult',
)
export type DatabaseMigrateResult = z.infer<typeof DatabaseMigrateResult>

export const ApiError = named(
  z
    .object({
      error: z.string(),
      detail: z.string().optional(),
      hint: z.string().optional(),
    })
    .strict()
    .describe('Uniform error envelope returned by the panel API'),
  'ApiError',
)
export type ApiError = z.infer<typeof ApiError>
