// The Development Context: everything an agent (or a person on a new machine)
// needs to read before working on a project, in one answer.
//
// Pure over its inputs. The route gathers the catalog, the scans, the issue
// and the services; this decides what goes in and in which words. The
// platform rules are the short version of docs/agent-guidelines.md, embedded
// so the answer is complete offline and needs no second request.

import type {
  ContextEnvironment,
  ContextRepository,
  ContextWorktree,
  DevelopmentContext,
  Diagnostic,
  Environment,
  EnvironmentServices,
  Issue,
  Project,
  RepositoryGit,
} from 'portta-contracts'
import { DEVELOPMENT_CONTEXT_SCHEMA, DEVELOPMENT_CONTEXT_VERSION } from 'portta-contracts'
import type { TaskflowWorktree } from '../modules/taskflow/worktrees.ts'

export const PLATFORM_INSTRUCTIONS = `## Shared development host

Other environments are running on this machine. They belong to other people or
other agents, and you cannot tell which by looking.

Never:
- stop or remove a container, volume or network you did not create
- run \`docker system prune\` or any \`docker * prune\`
- change an internal port to resolve a conflict
- publish a database or cache on the host (no \`5432:5432\`, ever)
- reuse another environment's volume or namespace
- stop Portta to fix your own project

Always:
- set a unique \`COMPOSE_PROJECT_NAME\` (\`portta namespace\`)
- check ownership before touching a container:
  \`docker inspect <c> --format '{{ index .Config.Labels "com.docker.compose.project" }}'\`
- run \`portta doctor\` before improvising infrastructure
- report URLs from \`portta urls\`, not \`localhost:3000\`
- reach databases in this order: \`docker compose exec\`, then
  \`portta db psql\` / \`redis cli\`, then \`portta access open\` for a GUI,
  then \`portta remote access open\` over the VPN for a VPS. Never by
  publishing a port, and never on \`0.0.0.0\`
- stop only what you started, from its own directory

Work through Portta's own model:
- \`portta issues list --project <slug>\` is the work to pick from, and
  \`portta issues show <ref> --project <slug>\` reads one in full, with its comments
- \`portta sessions start --project <slug> --issue <ref>\` says you are working;
  \`portta sessions end <id> --summary "<text>"\` when you stop
- \`portta issues comment <ref> "<text>" --project <slug>\` is how you leave a
  trace a person can read; \`portta issues close <ref> --project <slug>\` when it is done
- \`portta projects context <slug> --issue <ref>\` is this answer with the issue in it
- name the environment after the issue (\`portta envs namespace --suffix issue<n>\`,
  or a branch \`issue-<n>-…\`) and the panel links them for you

If a port seems taken, that is the signal that something publishes a port it
does not need. Fix that; do not free the port by force.
`

export interface ContextInput {
  now: number
  actor: string | null
  permissions: readonly string[]
  project: Project
  /** The issue the caller named, already read from its provider. */
  issue: Issue | null
  scans: Map<string, RepositoryGit>
  environments: Environment[]
  services: Map<string, EnvironmentServices>
  /** The worktrees the Taskflow daemon knows for this Project's directories; empty when it is off. */
  worktrees: readonly TaskflowWorktree[]
  /** Whether the module is on, and whether the daemon answered when it is. */
  taskflow: { enabled: boolean; reachable: boolean }
}

/**
 * The Compose project a Taskflow environment runs as, which is the name the
 * panel's inventory gives the Environment. The daemon derives it the same way
 * (`taskflow-<id without env_>`); the panel repeats the spelling rather than
 * ask, because the inventory is what it already has.
 */
export function environmentNameOf(environmentId: string): string {
  return `taskflow-${environmentId.replace(/^env_/, '')}`
}

function trimSlash(path: string): string {
  const clean = path.replace(/\/+$/, '')
  return clean === '' ? '/' : clean
}

export function contextWorktrees(input: ContextInput, directory: string | null): ContextWorktree[] {
  if (!directory) return []
  const adopted = new Set(input.environments.map((environment) => environment.name))
  const wanted = trimSlash(directory)
  return input.worktrees
    .filter((worktree) => trimSlash(worktree.directory) === wanted)
    .map((worktree) => {
      const name = worktree.environmentId ? environmentNameOf(worktree.environmentId) : null
      return {
        path: worktree.path,
        branch: worktree.branch,
        base: worktree.base,
        environmentId: worktree.environmentId,
        environment: name && adopted.has(name) ? name : null,
      }
    })
}

export function contextRepositories(input: ContextInput): ContextRepository[] {
  return input.project.repositories.map((repository) => {
    const scan = repository.scanKey ? input.scans.get(repository.scanKey) : undefined
    const path = repository.scanPath ?? repository.localPath
    return {
      id: repository.id,
      name: repository.name,
      role: repository.role,
      path,
      remoteUrl: repository.remoteUrl,
      git: repository.git,
      instructions: scan?.instructions ?? [],
      specifications: scan?.specifications ?? [],
      environments: repository.environments,
      worktrees: contextWorktrees(input, path),
    }
  })
}

function check(
  id: string,
  status: Diagnostic['status'],
  title: string,
  detail: string,
  fix: string,
  params?: Record<string, string | number>,
): Diagnostic {
  return { id, status, title, detail, fix, category: 'development', ...(params ? { params } : {}) }
}

/**
 * What is observed and wrong here, said outright. A consumer that reads the
 * context to start work should not have to infer from a null path or an old
 * `collectedAt` that something needs doing first; each of these names the
 * thing and the command that fixes it.
 */
export function contextDiagnostics(input: ContextInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const repository of input.project.repositories) {
    const path = repository.scanPath ?? repository.localPath
    if (!path) {
      diagnostics.push(
        check(
          `repository-path-unknown:${repository.name}`,
          'warn',
          `Repository ${repository.name} has no path`,
          'the panel does not know where this repository lives on the host, so nothing about its checkout can be read',
          `Register the path of ${repository.name} in the panel, or place it under the Project directory`,
          { repository: repository.name },
        ),
      )
      continue
    }
    const scan = repository.scanKey ? input.scans.get(repository.scanKey) : undefined
    if (!scan?.collected) {
      diagnostics.push(
        check(
          `scan-missing:${repository.name}`,
          'info',
          `Repository ${repository.name} is not scanned yet`,
          `no scan covers ${path}; branch, commits and instruction files are unknown`,
          'portta repos scan',
          { repository: repository.name, path },
        ),
      )
    } else if (scan.stale) {
      diagnostics.push(
        check(
          `scan-stale:${repository.name}`,
          'warn',
          `Repository ${repository.name} was scanned a while ago`,
          `the git state of ${path} is ${scan.ageSeconds ?? 0}s old, past the ${scan.staleAfterSeconds}s bound`,
          'portta repos scan',
          { repository: repository.name, ageSeconds: scan.ageSeconds ?? 0 },
        ),
      )
    }
  }
  for (const environment of input.environments) {
    if (environment.runningCount === 0) {
      diagnostics.push(
        check(
          `environment-stopped:${environment.name}`,
          'warn',
          `Environment ${environment.name} is stopped`,
          'the Project adopted it, and none of its services is running',
          `portta envs start ${environment.name}`,
          { environment: environment.name },
        ),
      )
    }
  }
  if (input.taskflow.enabled && !input.taskflow.reachable) {
    diagnostics.push(
      check(
        'taskflow-unreachable',
        'warn',
        'Taskflow host daemon did not answer',
        'the worktrees of this Project are unknown until it does',
        'portta flow doctor',
      ),
    )
  }
  return diagnostics
}

export function contextEnvironments(input: ContextInput): ContextEnvironment[] {
  const repositoryOf = new Map<string, string>()
  for (const repository of input.project.repositories)
    for (const env of repository.environments) repositoryOf.set(env, repository.id)
  return input.environments.map((environment) => {
    const repositoryId = repositoryOf.get(environment.name) ?? null
    const repository = input.project.repositories.find((r) => r.id === repositoryId)
    return {
      name: environment.name,
      running: environment.runningCount > 0,
      repository: repositoryId,
      branch: repository?.git?.branch ?? null,
      services: input.services.get(environment.name)?.services ?? [],
      logsCommand: `portta envs logs ${environment.name}`,
      startCommand: `portta envs start ${environment.name}`,
      stopCommand: `portta envs stop ${environment.name}`,
    }
  })
}

export function buildContext(input: ContextInput): DevelopmentContext {
  const repositories = contextRepositories(input)
  const issue = input.issue
  // The body and the comments, as an agent would read them on the provider. The
  // comments are included because they are where the actual decisions end up,
  // and an agent that only read the body re-litigates them.
  const issueText = issue
    ? [
        `# ${issue.key} ${issue.title}`,
        issue.body ?? '',
        ...(issue.comments.length > 0
          ? [
              '',
              '## Comments',
              ...issue.comments.map((comment) => `- ${comment.author?.login ?? 'someone'}: ${comment.body}`),
            ]
          : []),
      ]
        .join('\n')
        .trim()
    : null
  const slug = input.project.slug
  return {
    schema: DEVELOPMENT_CONTEXT_SCHEMA,
    version: DEVELOPMENT_CONTEXT_VERSION,
    generatedAt: Math.floor(input.now / 1000),
    actor: input.actor,
    permissions: [...input.permissions],
    project: {
      slug,
      name: input.project.name,
      description: input.project.description,
      path: input.project.resolvedPath,
    },
    issue,
    repositories,
    environments: contextEnvironments(input),
    instructions: {
      platform: PLATFORM_INSTRUCTIONS,
      project: input.project.description,
      repositories: repositories.flatMap((repository) =>
        repository.instructions.map((file) => ({
          repository: repository.name,
          path: file.path,
          audience: file.audience,
          content: file.content,
          truncated: file.truncated,
        })),
      ),
      issue: issueText,
    },
    commands: {
      context: `portta projects context ${slug}${issue ? ` --issue ${issue.ref}` : ''} --json`,
      issues: `portta issues list --project ${slug}`,
      openIssue: `portta issues show ${issue ? issue.ref : '<ref>'} --project ${slug}`,
      closeIssue: `portta issues close ${issue ? issue.ref : '<ref>'} --project ${slug}`,
      comment: `portta issues comment ${issue ? issue.ref : '<ref>'} "<text>" --project ${slug}`,
      startSession: `portta sessions start --project ${slug}${issue ? ` --issue ${issue.ref}` : ''}`,
      environments: `portta envs list --json`,
      repositories: `portta repos status --json`,
      doctor: 'portta doctor',
    },
    diagnostics: contextDiagnostics(input),
  }
}
