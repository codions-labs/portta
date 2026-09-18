// The verdicts `portta doctor` reaches, separated from the probes that gather
// their inputs.
//
// Everything here is a pure function of facts. That is what makes a diagnostic
// testable: "a 172.x address published on 0.0.0.0 is a finding" can be asserted
// without a Docker daemon, a tailnet or a certificate on disk. The probes live
// in `packages/cli/src/doctor.ts` and produce nothing but these inputs.
//
// `doctor` is read-only by construction. Nothing in this module or its callers
// applies a fix, stops a container or removes anything: a check reports, and
// names the command a person may choose to run.

// The one exception to "no imports": the access modes that may run without a
// login are policy, and policy lives in one place (config.ts) rather than in a
// set copied here.
import { allowsDisabledAuth, isPanelAccess } from './config.ts'

export type CheckStatus = 'pass' | 'info' | 'warn' | 'fail'

export interface CheckDetail {
  status: CheckStatus
  text: string
}

export interface ToolDiagnostic {
  installed: boolean
  version: string | null
  path: string | null
  minimum?: string
  recommended?: string
}

/** The canonical diagnostic record emitted by `portta doctor --json`. */
export interface DoctorCheck {
  id: string
  status: CheckStatus
  title: string
  detail: string
  fix: string
  category?: 'infrastructure' | 'development' | 'agents' | 'security'
  details?: CheckDetail[]
  tool?: ToolDiagnostic
  rationale?: string
  docs?: string
}

export function check(id: string, status: CheckStatus, title: string, detail: string, fix = ''): DoctorCheck {
  return { id, status, title, detail, fix }
}

export interface DoctorSummary {
  failures: number
  warnings: number
  ok: boolean
}

export function summarise(checks: DoctorCheck[]): DoctorSummary {
  const failures = checks.filter((entry) => entry.status === 'fail').length
  const warnings = checks.filter((entry) => entry.status === 'warn').length
  return { failures, warnings, ok: failures === 0 }
}

export interface EnvironmentReport {
  version: 1
  collectedAt: number
  durationMs: number
  checks: DoctorCheck[]
  summary: {
    passed: number
    recommendations: number
    problems: number
    information: number
    ok: boolean
  }
}

/** Host readiness changes slowly; resource metrics keep their five-second cadence. */
export const ENVIRONMENT_COLLECT_INTERVAL_MS = 5 * 60 * 1000

export function summariseEnvironment(checks: DoctorCheck[]): EnvironmentReport['summary'] {
  const count = (status: CheckStatus) => checks.filter((entry) => entry.status === status).length
  const problems = count('fail')
  return {
    passed: count('pass'),
    recommendations: count('warn'),
    problems,
    information: count('info'),
    ok: problems === 0,
  }
}

export interface EnvironmentToolFacts {
  installed: boolean
  path: string | null
  version: string | null
  onPath: boolean
  usable: boolean
  problem?: string
}

export interface EnvironmentToolOptions {
  id: string
  title: string
  category: NonNullable<DoctorCheck['category']>
  optional?: boolean
  minimum?: string
  recommended?: string
  fix?: string
  details?: CheckDetail[]
}

/** A common verdict for tools whose facts were gathered on the host. */
export function environmentToolVerdict(facts: EnvironmentToolFacts, options: EnvironmentToolOptions): DoctorCheck {
  const tool: ToolDiagnostic = {
    installed: facts.installed,
    version: facts.version,
    path: facts.path,
    ...(options.minimum ? { minimum: options.minimum } : {}),
    ...(options.recommended ? { recommended: options.recommended } : {}),
  }
  if (!facts.installed) {
    return {
      ...check(
        options.id,
        options.optional ? 'info' : 'fail',
        options.title,
        options.optional ? 'not installed (optional)' : 'not installed',
        options.fix ?? '',
      ),
      category: options.category,
      tool,
      details: options.details,
    }
  }
  if (!facts.usable) {
    return {
      ...check(
        options.id,
        options.optional ? 'warn' : 'fail',
        options.title,
        facts.problem ?? 'installed but not usable',
        options.fix ?? '',
      ),
      category: options.category,
      tool,
      details: options.details,
    }
  }
  if (!facts.onPath) {
    return {
      ...check(
        options.id,
        'warn',
        options.title,
        `${facts.version ?? 'installed'} at ${facts.path ?? 'an unknown path'}, but not on this PATH`,
        'export its directory in ~/.profile so scripts can reach it',
      ),
      category: options.category,
      tool,
      details: options.details,
    }
  }
  return {
    ...check(options.id, 'pass', options.title, facts.version ?? 'installed'),
    category: options.category,
    tool,
    details: options.details,
  }
}

/** The leading integer of a version string, or null when there is none. */
export function versionMajor(value: string): number | null {
  const match = /^v?(\d+)/.exec(value.trim())
  return match ? Number(match[1]) : null
}

export function meetsMinimum(value: string, minimum: number): boolean {
  const major = versionMajor(value)
  return major !== null && major >= minimum
}

/**
 * `.env` holds every credential the gateway has. Group- or world-readable is a
 * finding, not a preference — but a warning, because the file still works and
 * the operator may be the only user on the host.
 */
export function envPermissionVerdict(mode: string | null): DoctorCheck {
  if (!mode) return check('config.env.perms', 'warn', '.env permissions', 'could not be read')
  const numeric = Number.parseInt(mode, 8)
  const others = numeric & 0o077
  return others === 0
    ? check('config.env.perms', 'pass', '.env permissions', mode)
    : check('config.env.perms', 'warn', '.env permissions', `${mode} is group/world readable`, 'chmod 600 .env')
}

/**
 * A floating tag makes the gateway a different program after any `docker pull`.
 * See docs/development/adr/0004-pinned-versions.md.
 */
export function imageTagVerdict(image: string): DoctorCheck {
  const fix = 'pin a version in docker/compose/compose.yaml; see docs/development/adr/0004-pinned-versions.md'
  if (image.endsWith(':latest'))
    return check('traefik.image', 'warn', 'traefik image', `${image} uses the floating 'latest' tag`, fix)
  // A tag, not a registry port: `ghcr.io:443/x` has a colon and no tag.
  const tagged = /:[^/:]+$/.test(image)
  if (!tagged) return check('traefik.image', 'warn', 'traefik image', `${image} has no tag, which implies :latest`, fix)
  return check('traefik.image', 'pass', 'traefik image', image)
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', 'localhost', '::1'])

export function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRESSES.has(address)
}

export function isWildcardAddress(address: string): boolean {
  return address === '0.0.0.0' || address === '::'
}

/** A resolved address that only ever reaches the machine doing the lookup. */
export function isLoopbackIp(address: string): boolean {
  return address === '::1' || /^127(\.\d{1,3}){3}$/.test(address)
}

/**
 * `*.localhost` must resolve to loopback. No answer means the resolver in play
 * does not implement RFC 6761; any other answer means something upstream, a
 * wildcard DNS server or a search domain, claims a name it should not.
 */
export function localhostDnsVerdict(addresses: string[]): DoctorCheck {
  const hint = 'see docs/product/guides/local-development.md#how-localhost-resolves'
  if (addresses.length === 0)
    return check('dns.local', 'warn', 'local DNS', 'could not confirm *.localhost resolution', hint)
  const stray = addresses.filter((address) => !isLoopbackIp(address))
  return stray.length === 0
    ? check('dns.local', 'pass', 'local DNS', '*.localhost resolves to loopback')
    : check('dns.local', 'warn', 'local DNS', `*.localhost resolves to ${stray.join(', ')}, not loopback`, hint)
}

/**
 * A base domain pointed at loopback, by a local resolver or by a public record
 * for 127.0.0.1, is served by the default loopback bind. Suggesting public
 * exposure for it, as a domain pointed at this host's address would get, is
 * the wrong fix. Null when the domain does not resolve to loopback.
 */
export function loopbackDomainVerdict(domain: string, resolved: string, bind: string): DoctorCheck | null {
  if (!isLoopbackIp(resolved)) return null
  const served = isWildcardAddress(bind) || bind === resolved || (isLoopbackAddress(bind) && resolved === '127.0.0.1')
  return served
    ? check('domain.reachable', 'pass', 'project hostnames', `*.${domain} resolves to loopback, served on ${bind}`)
    : check(
        'domain.reachable',
        'warn',
        'project hostnames',
        `*.${domain} resolves to ${resolved}, but Traefik listens on ${bind}`,
        'point the wildcard at an address Traefik listens on; see docs/product/guides/local-domains.md',
      )
}

/**
 * Ports a gateway-owned container must never publish on every interface.
 * A database or the Docker API reachable from the network is the failure this
 * whole design exists to prevent.
 */
export const SENSITIVE_PORTS = ['5432/tcp', '3306/tcp', '6379/tcp', '27017/tcp', '2375/tcp', '2376/tcp']

export function publishesSensitivePort(published: string): boolean {
  return SENSITIVE_PORTS.some((port) => published.includes(`0.0.0.0:`) && published.includes(`->${port}`))
}

/**
 * The traffic Traefik answers, judged for the profile.
 *
 * The panel's own entrypoint (container port 8090) is public on purpose in
 * `public` access mode, and is the one port that is authenticated. Judging the
 * application entrypoints without it is what stops a correctly configured
 * public panel reading as a finding. See docs/development/adr/0021-panel-access-modes.md.
 */
export function applicationBinds(binds: string, panelIsPublic: boolean): string {
  if (!panelIsPublic) return binds
  return binds
    .split(' ')
    .filter((entry) => entry && !entry.startsWith('8090/tcp='))
    .join(' ')
}

export function exposureVerdict(profile: string, binds: string, panelIsPublic: boolean): DoctorCheck | null {
  const application = applicationBinds(binds, panelIsPublic)
  const publiclyBound = /0\.0\.0\.0:|::/.test(application)
  if (profile === 'local') {
    if (publiclyBound) {
      return check(
        'exposure.local',
        'fail',
        'local profile exposure',
        'an application entrypoint is bound to a non-loopback address in the local profile',
        "set PORTTA_BIND_ADDRESS=127.0.0.1 and run 'portta up local'",
      )
    }
    return check(
      'exposure.local',
      'pass',
      'local profile exposure',
      panelIsPublic ? 'applications on loopback; only the authenticated panel entrypoint is public' : 'loopback only',
    )
  }
  if (profile === 'remote-private') {
    return binds.includes('0.0.0.0:')
      ? check(
          'exposure.private',
          'fail',
          'private profile exposure',
          'ports are published on every interface while the profile is private',
          'bind to the VPN address or run Traefik behind the Tailscale sidecar',
        )
      : check('exposure.private', 'pass', 'private profile exposure', 'not publicly bound')
  }
  if (profile === 'remote-public') {
    return check(
      'exposure.public',
      'warn',
      'public profile',
      '80/443 are intentionally public',
      'only services that opted in are routed; databases are never published',
    )
  }
  return null
}

/**
 * Where the Traefik dashboard listens.
 *
 * It exposes the routing internals of every project on the host, so anything
 * but loopback is a failure rather than a warning.
 */
/**
 * Why a host must not route the dashboard on the domain, or null when it may.
 * Mirrors the panel's own `domain` refusals: a credential and a real domain.
 */
export function dashboardVerdict(enabled: boolean, bindAddress: string, port: string): DoctorCheck {
  if (!enabled) return check('dashboard', 'pass', 'traefik dashboard', 'disabled')
  return isLoopbackAddress(bindAddress)
    ? check('dashboard', 'pass', 'traefik dashboard', `enabled on ${bindAddress}:${port} (loopback)`)
    : check(
        'dashboard',
        'fail',
        'traefik dashboard',
        `enabled and bound to ${bindAddress}, which exposes routing internals`,
        'set PORTTA_DASHBOARD_BIND_ADDRESS=127.0.0.1 or PORTTA_DASHBOARD=false',
      )
}

export interface PanelFacts {
  expose: string
  bindAddress: string
  port: string
  /** `disabled` or `required`, as `.env` spells it. */
  authMode: string
  /** Whether PORTTA_AUTH_SECRET is set. Never the value. */
  secretPresent: boolean
  readOnly: boolean
  /** The named opt-in that lets `local` answer the LAN as the local operator. */
  allowLan?: boolean
}

const LOOPBACK_ONLY = new Set(['local'])

/**
 * What stands in front of the panel.
 *
 * The panel authenticates its own requests, so this checks that the access and
 * authentication decisions agree. `public` and `domain` answer whoever finds
 * the address and must be in `required` mode; `tailscale` and `vpn` are behind
 * a network that authenticates on its own, so no login there is a choice rather
 * than a hole; `local` on a LAN address is the one combination that needs the
 * operator to have said so out loud.
 *
 * It fails rather than warns where the panel's own process refuses to start, so
 * a failure here is a host that will not come up, not a host that is quietly
 * open. The `disabled` combinations Portta does accept are reported as warnings
 * with what they assume, because "no login" should never be invisible.
 */
export function panelAuthVerdicts(panel: PanelFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = []
  const required = panel.authMode === 'required'
  const reachable = !LOOPBACK_ONLY.has(panel.expose) || !isLoopbackAddress(panel.bindAddress)
  const openAllowed = isPanelAccess(panel.expose) && allowsDisabledAuth(panel.expose)
  const lan = panel.expose === 'local' && !isLoopbackAddress(panel.bindAddress)

  if (required) {
    checks.push(
      check(
        'web.auth',
        'pass',
        'panel authentication',
        reachable
          ? `signs people in (access: ${panel.expose})`
          : `signs people in; loopback only on ${panel.bindAddress}:${panel.port}`,
      ),
    )
  } else if (!openAllowed) {
    checks.push(
      check(
        'web.auth',
        'fail',
        'panel authentication',
        `the panel is reachable beyond this host (access: ${panel.expose}, bind: ${panel.bindAddress}) and asks nobody who they are`,
        'portta config set panel.auth required   then portta web up',
      ),
    )
  } else if (lan && !panel.allowLan) {
    checks.push(
      check(
        'web.auth',
        'fail',
        'panel authentication',
        `the panel is bound to ${panel.bindAddress} and asks nobody who they are; the local network is not an authenticated set`,
        'portta config set panel.auth required   (or set PORTTA_AUTH_ALLOW_LAN=true to accept it)',
      ),
    )
  } else if (lan) {
    checks.push(
      check(
        'web.auth',
        'warn',
        'panel authentication',
        `local operator for every device on this network (bind: ${panel.bindAddress}), because PORTTA_AUTH_ALLOW_LAN is set`,
        'portta config set panel.auth required   asks who they are instead',
      ),
    )
  } else if (!reachable) {
    checks.push(
      check(
        'web.auth',
        'pass',
        'panel authentication',
        `local operator; loopback only on ${panel.bindAddress}:${panel.port}`,
      ),
    )
  } else {
    checks.push(
      check(
        'web.auth',
        'warn',
        'panel authentication',
        `local operator for anybody who reaches it over the ${panel.expose === 'tailscale' ? 'tailnet' : 'VPN'} (access: ${panel.expose})`,
        'portta config set panel.auth required   asks who they are instead',
      ),
    )
  }

  if (required) {
    checks.push(
      panel.secretPresent
        ? check('web.auth.secret', 'pass', 'panel session secret', 'set')
        : check(
            'web.auth.secret',
            'fail',
            'panel session secret',
            'PORTTA_AUTH_MODE=required with no PORTTA_AUTH_SECRET: the panel refuses to start',
            'portta web up   (generates it without printing it)',
          ),
    )
  }

  if (reachable && !panel.readOnly) {
    checks.push(
      check(
        'web.readonly',
        'warn',
        'panel write access',
        required
          ? 'reachable and writable: whoever signs in can stop containers'
          : 'reachable and writable: whoever reaches it can stop containers, and it asks nobody who they are',
        'portta web up --read-only',
      ),
    )
  }
  return checks
}

/**
 * Whether a gateway component is unstarted or broken.
 *
 * `portta bootstrap` ends by running doctor, on a host where nothing has been
 * started yet. Treating "does not exist" as a failure made bootstrap exit 1 on
 * every fresh host, and every CI job that boots the gateway died before `up`.
 * A component that does not exist yet is a **warning**; a component in a bad
 * state stays a failure.
 */
export function componentVerdict(
  id: string,
  title: string,
  present: boolean,
  state: string | null,
  health: string | null,
  fix: string,
): DoctorCheck {
  if (!present) return check(id, 'warn', title, 'container not created', fix)
  if (state !== 'running' || health === 'unhealthy')
    return check(id, 'fail', title, `${state} (${health ?? 'none'})`, fix)
  if (health === 'starting') return check(id, 'warn', title, 'health check is still starting', fix)
  return check(id, 'pass', title, `${state} (${health ?? 'none'})`)
}

/**
 * The store holding every protected host's credential.
 *
 * Same rule as `componentVerdict`: absent *and* nothing running is a gateway
 * that has not started yet. Absent while the service runs is broken.
 */
export function authStoreVerdict(present: boolean, mode: string | null, serviceExists: boolean): DoctorCheck {
  if (!present && !serviceExists) {
    return check(
      'auth.store',
      'warn',
      'authentication store',
      'not created yet',
      'portta up   (creates and migrates it)',
    )
  }
  if (!present) {
    return check(
      'auth.store',
      'fail',
      'authentication store',
      'missing while the service is running',
      'portta up   (creates and migrates it)',
    )
  }
  return mode === '600'
    ? check('auth.store', 'pass', 'authentication store', 'present at mode 600')
    : check(
        'auth.store',
        'fail',
        'authentication store',
        `mode ${mode ?? 'unknown'}; credentials must be owner-only`,
        'chmod 600 state/auth/protections.json',
      )
}

/**
 * Two Compose projects whose names differ only in punctuation collapse to the
 * same hostname once normalised. That silently steals traffic.
 */
export function duplicates(values: string[]): string[] {
  const seen = new Map<string, number>()
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1)
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

/** Images that are almost always a mistake on the shared HTTP network. */
const DATASTORE_IMAGE = /postgres|mysql|mariadb|redis|mongo|memcached/i

export function looksLikeDatastore(image: string): boolean {
  return DATASTORE_IMAGE.test(image)
}

/**
 * Compose interpolates `${VAR}` inside a label written in list form but not
 * inside a mapping key. A project that used the map form ships labels with a
 * literal `${...}`, and every worktree of it then collapses onto one Traefik
 * service. Cheap to detect, very confusing to debug.
 */
export function hasUninterpolatedLabel(labels: Record<string, string>): boolean {
  return Object.entries(labels).some(
    ([key, value]) => key.startsWith('traefik.') && (key.includes('${') || value.includes('${')),
  )
}

/** The Traefik service names a container declares. One flat namespace per host. */
export function traefikServiceNames(labels: Record<string, string>): string[] {
  const names = new Set<string>()
  for (const key of Object.keys(labels)) {
    const match = /^traefik\.http\.services\.([^.]+)\./.exec(key)
    if (match) names.add(match[1]!)
  }
  return [...names]
}
