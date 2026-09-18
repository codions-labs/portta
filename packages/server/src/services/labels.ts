// Label names the gateway and Compose already use. The panel reads them; it
// never writes a label of its own except on the access bridges it creates,
// which must be indistinguishable from the ones `portta access open`
// creates so the CLI keeps managing them.

export const LABELS = {
  managed: 'portta.managed',
  component: 'portta.component',

  // Optional, and optional on purpose: everything below is inferred from the
  // Compose labels when it is absent, and a project that sets none behaves
  // exactly as it did before they existed. See
  // docs/development/adr/0010-git-collected-on-the-host.md.
  //
  //   project   the logical project, when COMPOSE_PROJECT_NAME is a per-worktree
  //             namespace and several worktrees belong under one heading
  //   repo      `owner/name` or a remote URL, which gives forge links with no
  //             host-side Git at all
  //   gitRoot   the repository root, when the Compose file is not at it
  project: 'portta.project',
  repo: 'portta.repo',
  gitRoot: 'portta.git.root',

  composeProject: 'com.docker.compose.project',
  composeService: 'com.docker.compose.service',
  composeWorkingDir: 'com.docker.compose.project.working_dir',
  composeConfigFiles: 'com.docker.compose.project.config_files',
  composeContainerNumber: 'com.docker.compose.container-number',
  composeDependsOn: 'com.docker.compose.depends_on',
  // `True` on a `docker compose run` container. It carries the service's
  // labels too, so without this it would pass for a second copy of the service.
  composeOneoff: 'com.docker.compose.oneoff',

  traefikEnable: 'traefik.enable',

  accessId: 'portta.access.id',
  accessProject: 'portta.access.project',
  accessService: 'portta.access.service',
  accessPort: 'portta.access.port',
  accessNetwork: 'portta.access.network',
  accessKind: 'portta.access.kind',
  accessCreated: 'portta.access.created',
  accessExpires: 'portta.access.expires',

  forwardAlias: 'portta.forward.alias',
  forwardProject: 'portta.forward.project',
  forwardService: 'portta.forward.service',
  forwardPort: 'portta.forward.port',
  forwardKind: 'portta.forward.kind',
} as const

/** Labels worth showing in the UI. Everything else is noise on a detail panel. */
const INTERESTING_PREFIXES = ['portta.', 'traefik.', 'com.docker.compose.project', 'org.opencontainers.']
const INTERESTING_EXACT: string[] = [
  LABELS.composeProject,
  LABELS.composeService,
  LABELS.traefikEnable,
  LABELS.composeDependsOn,
]

export function relevantLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (INTERESTING_EXACT.includes(key) || INTERESTING_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value
    }
  }
  return out
}
