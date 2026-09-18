// The checks the panel can make honestly from inside a container.
//
// This is deliberately not a reimplementation of `portta doctor`: that
// runs on the host and inspects things a container cannot see truthfully
// (binaries in PATH, listening sockets, DNS resolution, certificate files on
// disk). What is here is everything derivable from Docker and the resolved
// configuration, which is exactly what the panel already has.

import { existsSync, statSync } from 'node:fs'
import type { Diagnostic, ForgeStatus, Share, TraefikVerdict } from 'portta-contracts'
import { parseEnv, readEnvFile, readProtectionStore, type StoredAlias } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { isProtected, isRouted } from '../config.ts'
import type { DatabaseStatus } from '../db/index.ts'
import { GENERATED_FILES, isDirWritable, readGenerated } from './dynamic.ts'
import { componentOf } from './gateway.ts'
import type { Snapshot } from './inventory.ts'
import { routersFor } from './traefik.ts'

function check(
  id: string,
  status: Diagnostic['status'],
  title: string,
  detail: string,
  fix = '',
  params?: Record<string, string | number>,
): Diagnostic {
  return { id, status, title, detail, fix, ...(params ? { params } : {}) }
}

export function diagnose(
  snapshot: Snapshot,
  config: PanelConfig,
  verdict: TraefikVerdict | null = null,
  shares: Share[] = [],
  database: DatabaseStatus | null = null,
  aliases: StoredAlias[] = [],
  forge: ForgeStatus | null = null,
): Diagnostic[] {
  const results: Diagnostic[] = []

  // Silence when nothing is linked: a Portta whose Projects have no remote and
  // no Linear key has nothing to read issues from, and saying so on every
  // doctor run would be noise. What is worth saying is that the tool exists but
  // nobody is signed in — that is a fixable thing the operator cannot see.
  if (forge) {
    for (const [name, status, fix] of [
      ['github', forge.github, 'run gh auth login on this host'],
      ['linear', forge.linear, 'set LINEAR_API_KEY on the host running portta host serve'],
    ] as const) {
      if (!status.available) continue
      results.push(
        status.authenticated
          ? check(
              `issues.${name}`,
              'pass',
              name === 'github' ? 'GitHub Issues' : 'Linear',
              `signed in as ${status.account}`,
            )
          : check(
              `issues.${name}`,
              'warn',
              name === 'github' ? 'GitHub Issues' : 'Linear',
              status.reason ?? 'nobody is signed in',
              fix,
            ),
      )
    }
  }

  if (database?.configured) {
    if (database.available) {
      results.push(check('database', 'pass', 'Panel persistence', `${database.migrations.length} migration(s) applied`))
    } else {
      results.push(
        check(
          'database',
          'warn',
          'Panel persistence',
          database.reason ?? 'the panel database cannot be opened; stored preferences are unavailable',
          'portta db status',
        ),
      )
    }
  }

  if (!snapshot.reachable) {
    results.push(check('docker', 'fail', 'Docker API', 'the panel cannot reach its socket proxy', 'portta web restart'))
    return results
  }
  results.push(check('docker', 'pass', 'Docker API', 'reachable through the panel socket proxy'))

  const traefik = componentOf(snapshot, 'traefik')
  if (!traefik) {
    results.push(check('traefik', 'fail', 'Traefik', 'no gateway container found', `portta up ${config.profile}`))
  } else if (traefik.state !== 'running') {
    results.push(check('traefik', 'fail', 'Traefik', `container is ${traefik.state}`, `portta up ${config.profile}`))
  } else if (traefik.health === 'unhealthy') {
    results.push(check('traefik', 'fail', 'Traefik', 'container is unhealthy', 'portta logs traefik'))
  } else if (traefik.health === 'starting') {
    results.push(check('traefik', 'warn', 'Traefik', 'health check is still starting', ''))
  } else {
    results.push(check('traefik', 'pass', 'Traefik', `running (${traefik.health})`))
  }

  const proxy = componentOf(snapshot, 'socket-proxy')
  if (proxy?.state !== 'running') {
    results.push(
      check(
        'socket-proxy',
        'fail',
        'Traefik socket proxy',
        proxy ? `container is ${proxy.state}` : 'missing',
        `portta up ${config.profile}`,
      ),
    )
  } else {
    results.push(check('socket-proxy', 'pass', 'Traefik socket proxy', 'running'))
  }

  const network = snapshot.networks.find((item) => item.name === config.network)
  if (!network) {
    results.push(check('network', 'fail', 'Shared network', `${config.network} does not exist`, 'portta bootstrap'))
  } else {
    results.push(
      check('network', 'pass', 'Shared network', `${config.network}: ${network.containerCount} container(s) attached`),
    )
  }

  // A project that opted into Traefik but never joined the shared network is
  // the single most common adoption mistake, and Traefik reports nothing.
  const orphanRoutes = snapshot.containers.filter(
    (container) =>
      container.ownership !== 'gateway' &&
      container.traefikEnabled &&
      container.state === 'running' &&
      !container.onGatewayNetwork,
  )
  if (orphanRoutes.length > 0) {
    results.push(
      check(
        'routes-off-network',
        'fail',
        'Routed services off the shared network',
        orphanRoutes.map((container) => container.name).join(', '),
        `attach them to the ${config.network} network; see docs/product/guides/adopting-projects.md`,
      ),
    )
  } else {
    results.push(
      check('routes-off-network', 'pass', 'Routed services', 'every routed service is on the shared network'),
    )
  }

  // Two containers claiming the same hostname: Traefik keeps one router and
  // silently drops the other.
  const byHost = new Map<string, string[]>()
  for (const container of snapshot.containers) {
    if (container.state !== 'running') continue
    for (const url of container.urls) {
      const list = byHost.get(url.host)
      if (list) list.push(container.name)
      else byHost.set(url.host, [container.name])
    }
  }
  const duplicates = [...byHost.entries()].filter(([, names]) => names.length > 1)
  if (duplicates.length > 0) {
    results.push(
      check(
        'hostname-collision',
        'fail',
        'Hostname collisions',
        duplicates.map(([host, names]) => `${host} (${names.join(', ')})`).join('; '),
        'give the projects distinct COMPOSE_PROJECT_NAMEs: portta namespace',
      ),
    )
  } else {
    results.push(check('hostname-collision', 'pass', 'Hostnames', 'no collisions'))
  }

  // The URLs this panel hands out have to be openable by whoever is reading
  // them. Both halves of that are configuration, so this is answerable here
  // without a single network call: the name resolves off this machine or it
  // does not, and Traefik answers off this machine or it does not.
  const localName = config.domain === 'localhost' || config.domain.endsWith('.localhost')
  const loopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(config.bindAddress)
  if (config.domainProblem) {
    results.push(
      check('project-domain', 'fail', 'Project hostnames', config.domainProblem, 'portta config set domain.mode auto'),
    )
  } else if (localName && config.webExpose !== 'local') {
    // Whoever is reading this panel is not on the machine, so every project URL
    // it shows them is unopenable. This is the failure ADR 0022 exists for.
    results.push(
      check(
        'project-domain',
        'warn',
        'Project hostnames',
        `projects answer on *.${config.domain}, which only resolves on this host, and this panel is reached from elsewhere`,
        'portta config set domain.mode auto',
      ),
    )
  } else if (!localName && loopbackOnly) {
    results.push(
      check(
        'project-domain',
        'warn',
        'Project hostnames',
        `*.${config.domain} points here, but Traefik listens on ${config.bindAddress} only, so nothing answers from outside`,
        'portta public enable',
      ),
    )
  } else {
    results.push(check('project-domain', 'pass', 'Project hostnames', `projects answer on *.${config.domain}`))
  }

  // One COMPOSE_PROJECT_NAME, two checkouts: Compose treats both as the same
  // project, so `up` in either directory recreates the other's containers.
  // Nothing reports it; the labels are the only trace.
  const workingDirs = new Map<string, Set<string>>()
  for (const container of snapshot.containers) {
    const environment = container.labels['com.docker.compose.project']
    const workingDir = container.labels['com.docker.compose.project.working_dir']
    if (!environment || !workingDir) continue
    const dirs = workingDirs.get(environment)
    if (dirs) dirs.add(workingDir)
    else workingDirs.set(environment, new Set([workingDir]))
  }
  for (const [environment, dirs] of [...workingDirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (dirs.size < 2) continue
    results.push(
      check(
        'split-working-dir',
        'warn',
        `Environment '${environment}' runs from two directories`,
        [...dirs].sort().join(', '),
        'two checkouts share a COMPOSE_PROJECT_NAME; give one of them another name (portta namespace)',
        { name: environment },
      ),
    )
  }

  const conflicts = snapshot.ports.filter((usage) => usage.conflict)
  if (conflicts.length > 0) {
    results.push(
      check(
        'port-conflict',
        'warn',
        'Published port conflicts',
        conflicts.map((usage) => `${usage.hostPort}/${usage.protocol}`).join(', '),
        'stop one of the containers, or move it off the port',
      ),
    )
  } else {
    results.push(check('port-conflict', 'pass', 'Published ports', 'no port is claimed twice'))
  }

  // Somebody else on 80/443 means the gateway will not come back after a
  // restart, and the error only shows up then.
  const gatewayPorts = new Set([Number(config.httpPort), Number(config.httpsPort)])
  const squatters = snapshot.ports.filter(
    (usage) => gatewayPorts.has(usage.hostPort) && usage.bindings.some((binding) => binding.ownership !== 'gateway'),
  )
  if (squatters.length > 0) {
    results.push(
      check(
        'gateway-ports',
        'warn',
        'Gateway ports taken by other containers',
        squatters
          .map((usage) => `${usage.hostPort}: ${usage.bindings.map((b) => b.containerName).join(', ')}`)
          .join('; '),
        'stop the container, or change PORTTA_HTTP_PORT / PORTTA_HTTPS_PORT',
      ),
    )
  }

  const unhealthy = snapshot.containers.filter(
    (container) => container.state === 'running' && container.health === 'unhealthy',
  )
  if (unhealthy.length > 0) {
    results.push(
      check(
        'unhealthy',
        'warn',
        'Unhealthy containers',
        unhealthy.map((container) => container.name).join(', '),
        'open the container logs',
      ),
    )
  } else {
    results.push(check('unhealthy', 'pass', 'Container health', 'nothing is unhealthy'))
  }

  const now = snapshot.at
  const staleBridges = snapshot.containers.filter((container) => {
    if (container.gatewayComponent !== 'access-bridge') return false
    if (container.state !== 'running') return true
    const expires = Number(container.labels['portta.access.expires'] ?? '')
    return Number.isFinite(expires) && expires > 0 && expires < now
  })
  if (staleBridges.length > 0) {
    results.push(
      check(
        'stale-bridges',
        'warn',
        'Stale access bridges',
        `${staleBridges.length} bridge(s) expired or stopped`,
        'portta access gc',
      ),
    )
  }

  if (config.profile === 'remote-public' && config.publicEnabled) {
    results.push(
      check(
        'public',
        'warn',
        'Public access',
        `HTTP services are reachable on ${config.publicDomain ?? config.domain}`,
        'portta public disable turns this off',
      ),
    )
  }

  results.push(...authChecks(snapshot, config))
  results.push(...panelChecks(config))
  if (verdict) results.push(...traefikChecks(snapshot, verdict))
  results.push(...shareChecks(shares))
  results.push(...aliasChecks(snapshot, aliases))

  if (config.tlsEnabled && config.tlsMode === 'acme' && !config.acmeEmailSet) {
    results.push(check('acme-email', 'fail', 'ACME', 'TLS_MODE=acme without ACME_EMAIL', 'set ACME_EMAIL in Settings'))
  }

  if (config.profile === 'remote-private' && !config.tailscaleEnabled && config.bindAddress === '0.0.0.0') {
    results.push(
      check(
        'bind-address',
        'fail',
        'Bind address',
        'the private profile is bound to every interface',
        'set PORTTA_BIND_ADDRESS to the VPN address, or enable Tailscale',
      ),
    )
  }

  return results
}

/**
 * An alias pins a container name, so an environment recreated under a different
 * namespace leaves a router pointing at nothing. Traefik reports no error for
 * that: the hostname simply stops answering, which is exactly the class of
 * silence a diagnostic exists for.
 */
function aliasChecks(snapshot: Snapshot, aliases: StoredAlias[]): Diagnostic[] {
  if (aliases.length === 0) return []

  const names = new Set(snapshot.containers.map((container) => container.name))
  const dangling = aliases.filter((alias) => !names.has(alias.container))

  if (dangling.length === 0) {
    return [check('aliases', 'pass', 'Hostname aliases', `${aliases.length} routed beside their derived hostname`)]
  }
  return [
    check(
      'aliases-dangling',
      'warn',
      'Aliases pointing at a container that is gone',
      dangling.map((alias) => `${alias.host} -> ${alias.container}`).join(', '),
      'remove the alias, or set it again once the environment is back',
    ),
  ]
}

/**
 * A share that outlives the reason for it, and a share pointing at a container
 * that is gone. Both are silent otherwise: nobody goes looking for an exposure
 * they set up on Tuesday.
 */
function shareChecks(shares: Share[]): Diagnostic[] {
  if (shares.length === 0) return []

  const results: Diagnostic[] = []
  const expired = shares.filter((share) => share.state === 'expired')
  const dangling = shares.filter((share) => share.state === 'dangling')

  if (expired.length > 0) {
    results.push(
      check(
        'shares-expired',
        'warn',
        'Expired shares',
        expired.map((share) => `${share.host} (${share.mode})`).join(', '),
        'portta share gc',
      ),
    )
  }
  if (dangling.length > 0) {
    results.push(
      check(
        'shares-dangling',
        'warn',
        'Shares pointing at a container that is gone',
        dangling.map((share) => `${share.host} -> ${share.container}`).join(', '),
        'revoke them, or recreate them against the new container',
      ),
    )
  }
  const active = shares.filter((share) => share.state === 'active')
  if (active.length > 0 && results.length === 0) {
    results.push(check('shares', 'pass', 'Temporary shares', `${active.length} active, all with an expiry`))
  }
  return results
}

/**
 * The one check the labels cannot make: what Traefik actually did with them.
 *
 * Only possible when the dashboard is enabled, so its absence says "not asked"
 * rather than "no problem". Everything else in this file stays true either way.
 */
function traefikChecks(snapshot: Snapshot, verdict: TraefikVerdict): Diagnostic[] {
  if (!verdict.available) {
    return [
      check(
        'traefik-verdict',
        'warn',
        "Traefik's own view",
        verdict.reason ?? 'not available',
        'set PORTTA_DASHBOARD=true to let the panel read Traefik directly',
      ),
    ]
  }

  const results: Diagnostic[] = []
  const routed = snapshot.containers.filter(
    (container) => container.state === 'running' && container.ownership !== 'gateway' && container.urls.length > 0,
  )

  // The labels look right and it still 404s: Traefik built no router at all.
  const missing = routed.filter((container) => routersFor(container, verdict).length === 0)
  if (missing.length > 0) {
    results.push(
      check(
        'traefik-no-router',
        'fail',
        'Services Traefik never routed',
        missing.map((container) => `${container.name} (${container.urls[0]?.host ?? '?'})`).join(', '),
        'check traefik.docker.network and that the container is on the shared network',
      ),
    )
  }

  // A router Traefik rejected, with Traefik's own words rather than a guess.
  const rejected = routed.flatMap((container) =>
    routersFor(container, verdict)
      .filter((router) => router.status !== 'enabled')
      .map(
        (router) => `${router.name}: ${router.status}${router.errors.length ? ` (${router.errors.join('; ')})` : ''}`,
      ),
  )
  if (rejected.length > 0) {
    results.push(
      check(
        'traefik-router-status',
        'fail',
        'Routers Traefik refused',
        rejected.join('; '),
        'open the router in the Traefik dashboard',
      ),
    )
  }

  if (missing.length === 0 && rejected.length === 0) {
    results.push(
      check(
        'traefik-verdict',
        'pass',
        "Traefik's own view",
        `${verdict.routers.length} router(s), every routed service among them`,
      ),
    )
  }

  return results
}

/**
 * The panel's own front door. A routed panel can stop containers and, since
 * ADR 0010, says what is being worked on, so this fails rather than warns:
 * the same precedent `doctor` already applies to a non-loopback dashboard.
 */
function panelChecks(config: PanelConfig): Diagnostic[] {
  const results: Diagnostic[] = []

  if (!isRouted(config)) {
    results.push(
      check(
        'panel-auth',
        'pass',
        'Panel exposure',
        'reachable on loopback only, where reaching it already means having the machine',
      ),
    )
    return results
  }

  if (!isProtected(config)) {
    results.push(
      check(
        'panel-auth',
        'fail',
        'Panel authentication',
        `the panel is routed (expose: ${config.webExpose}) and answers everybody as the local operator`,
        'set PORTTA_AUTH_MODE=required and run portta bootstrap for a secret',
      ),
    )
  } else {
    results.push(check('panel-auth', 'pass', 'Panel authentication', 'the panel signs people in'))
  }

  if (!config.readOnly) {
    results.push(
      check(
        'panel-read-only',
        'warn',
        'Panel is routed and writable',
        'anyone who gets past the credential can stop and remove containers',
        'portta web up --read-only',
      ),
    )
  }

  // A middleware Traefik cannot resolve makes the router fail closed, so this
  // is about a locked-out user rather than an open panel.
  const rendered = readGenerated(config.dynamicDir, GENERATED_FILES.auth)
  if (!rendered?.includes('portta-forward-auth:')) {
    results.push(
      check(
        'panel-auth-file',
        'warn',
        'Panel middleware is out of step',
        `${GENERATED_FILES.auth} does not define portta-forward-auth` +
          (isDirWritable(config.dynamicDir) ? '' : ', and the directory is not writable by the panel'),
        'portta web auth apply',
      ),
    )
  }

  return results
}

function authChecks(snapshot: Snapshot, config: PanelConfig): Diagnostic[] {
  const results: Diagnostic[] = []
  const saved = parseEnv(readEnvFile(config.envFile))
  results.push(
    saved.get('PORTTA_AUTH_SECRET')
      ? check('auth-secret', 'pass', 'Authentication signing secret', 'set')
      : check(
          'auth-secret',
          'fail',
          'Authentication signing secret',
          'PORTTA_AUTH_SECRET is unset',
          'portta bootstrap',
        ),
  )

  if (!existsSync(config.authStore)) {
    results.push(check('auth-store', 'fail', 'Authentication store', 'missing', 'portta up'))
  } else {
    try {
      const mode = statSync(config.authStore).mode & 0o777
      readProtectionStore(config.authStore)
      results.push(
        mode === 0o600
          ? check('auth-store', 'pass', 'Authentication store', 'valid and owner-only')
          : check(
              'auth-store',
              'fail',
              'Authentication store',
              `mode ${mode.toString(8)}; credentials must be owner-only`,
              'chmod 600 state/auth/protections.json',
            ),
      )
    } catch (error) {
      results.push(check('auth-store', 'fail', 'Authentication store', `invalid: ${String(error)}`, 'portta up'))
    }
  }

  const auth = componentOf(snapshot, 'auth')
  if (auth?.state !== 'running') {
    results.push(
      check(
        'auth-service',
        'fail',
        'Authentication service',
        auth ? `container is ${auth.state}` : 'missing',
        'portta up',
      ),
    )
  } else if (auth.health === 'unhealthy') {
    results.push(
      check('auth-service', 'fail', 'Authentication service', 'container is unhealthy', 'portta logs portta-auth'),
    )
  } else if (auth.health === 'starting') {
    results.push(check('auth-service', 'warn', 'Authentication service', 'health check is still starting'))
  } else {
    results.push(check('auth-service', 'pass', 'Authentication service', `running (${auth.health})`))
  }
  return results
}

export function problemsOnly(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.status !== 'pass')
}
