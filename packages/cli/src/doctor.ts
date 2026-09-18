// `portta doctor`: read-only diagnostics.
//
// Reports problems and names the fix; never applies one, never stops a
// container, never removes anything.
//
// This file is the probe half. Every verdict it reaches is a pure function in
// `packages/core/src/diagnostics.ts`, so what a check *decides* can be tested
// without a Docker daemon, a tailnet, DNS or a certificate on disk. What is
// here is the gathering: one `docker inspect` over every container, a handful
// of network lookups, and the host probes in `host.ts`.
//
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  authStoreVerdict,
  type ContainerRecord,
  check,
  componentVerdict,
  type DoctorCheck,
  dashboardVerdict,
  databaseFileFor,
  duplicates,
  envPermissionVerdict,
  exposureVerdict,
  hasUninterpolatedLabel,
  imageTagVerdict,
  isGatewayProfile,
  isLoopbackAddress,
  isLoopbackIp,
  isTrue,
  isWildcardAddress,
  localhostDnsVerdict,
  looksLikeDatastore,
  loopbackDomainVerdict,
  meetsMinimum,
  panelAuthVerdicts,
  publishesSensitivePort,
  routesFor,
  traefikServiceNames,
} from 'portta-core'
import { composeArguments, type GatewayContext } from './context.js'
import { inspectContainers } from './docker.js'
import { collectEnvironmentChecks } from './environment/index.js'
import { fileMode, isPrivateAddress, locate } from './host.js'
import { CLI_MODULES, moduleDoctorChecks } from './modules/index.js'
import { runProcess } from './process.js'

const MIN_COMPOSE_MAJOR = 2

/** Every published binding as `<ip>:<port>`, the way the shell reported them. */
function publishedBindings(container: ContainerRecord): string {
  return container.ports
    .filter((port) => port.publicPort !== null)
    .map((port) => `${port.ip}:${port.publicPort}`)
    .join(' ')
}

/** `<privatePort>/<type>=<ip>:<publicPort>`, the shape the exposure verdict reads. */
function bindMap(container: ContainerRecord): string {
  return container.ports
    .filter((port) => port.publicPort !== null)
    .map((port) => `${port.privatePort}/${port.type}=${port.ip}:${port.publicPort}`)
    .join(' ')
}

function publishedWithTargets(container: ContainerRecord): string {
  return container.ports
    .filter((port) => port.publicPort !== null)
    .map((port) => `${port.ip}:${port.publicPort}->${port.privatePort}/${port.type}`)
    .join(' ')
}

function gatewayContainer(containers: ContainerRecord[], component: string): ContainerRecord | undefined {
  return containers.find(
    (container) => container.labels['portta.managed'] === 'true' && container.labels['portta.component'] === component,
  )
}

async function networkFacts(
  name: string,
): Promise<{ exists: boolean; internal: boolean; managed: boolean; endpoints: number }> {
  const result = await runProcess(
    'docker',
    [
      'network',
      'inspect',
      name,
      '--format',
      '{{ .Internal }}\t{{ index .Labels "portta.managed" }}\t{{ len .Containers }}',
    ],
    { reject: false },
  )
  if (result.failed) return { exists: false, internal: false, managed: false, endpoints: 0 }
  const [internal = '', managed = '', endpoints = '0'] = result.stdout.trim().split('\t')
  return { exists: true, internal: internal === 'true', managed: managed === 'true', endpoints: Number(endpoints) || 0 }
}

async function version(command: string, args: string[]): Promise<string | null> {
  const result = await runProcess(command, args, { reject: false })
  return result.failed ? null : (result.stdout.trim().split('\n')[0] ?? null)
}

// ============================================================================

export async function runDoctor(context: GatewayContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  const env = context.env
  const config = context.config
  const root = context.root
  const stateDir = env.PORTTA_STATE_DIR || join(root, 'state')
  const add = (...entries: (DoctorCheck | null)[]) => {
    for (const entry of entries) if (entry) checks.push(entry)
  }

  // --- identity and configuration ------------------------------------------
  add(check('gateway.version', 'pass', 'gateway version', context.version))
  add(
    isGatewayProfile(env.PORTTA_PROFILE ?? config.profile)
      ? check('config.profile', 'pass', 'profile', config.profile)
      : check(
          'config.profile',
          'fail',
          'profile',
          `unknown profile '${env.PORTTA_PROFILE}'`,
          'set PORTTA_PROFILE to one of: local remote-private remote-public',
        ),
  )

  const envPath = join(root, '.env')
  if (existsSync(envPath)) {
    add(check('config.env', 'pass', '.env', 'present'))
    add(envPermissionVerdict(fileMode(envPath)))
  } else {
    add(check('config.env', 'warn', '.env', 'absent; running on built-in defaults', 'cp .env.example .env'))
  }

  // --- runtime -------------------------------------------------------------
  // The host report and `doctor` intentionally share the same Docker row.
  // Do not independently reconstruct Docker's verdict.
  const environmentChecks = await collectEnvironmentChecks()
  const dockerEnvironmentCheck = environmentChecks.find((entry) => entry.id === 'runtime.docker')
  add(dockerEnvironmentCheck ?? check('runtime.docker', 'fail', 'Docker', 'diagnostic unavailable'))

  const dockerPath = await locate('docker')
  let dockerUp = false
  if (dockerPath) {
    const info = await runProcess('docker', ['info'], { reject: false })
    dockerUp = !info.failed
    if (dockerUp) {
      add(
        check('runtime.context', 'pass', 'docker context', (await version('docker', ['context', 'show'])) ?? 'unknown'),
      )
    }
  }

  const compose = await version('docker', ['compose', 'version', '--short'])
  add(
    compose === null
      ? check('runtime.compose', 'fail', 'docker compose', 'plugin missing', 'install the Docker Compose v2 plugin')
      : meetsMinimum(compose, MIN_COMPOSE_MAJOR)
        ? check('runtime.compose', 'pass', 'docker compose', compose)
        : check('runtime.compose', 'fail', 'docker compose', `v${compose} is too old`, 'install the Compose v2 plugin'),
  )

  if (!dockerUp) {
    add(...environmentChecks.filter((entry) => entry.id !== 'runtime.docker'))
    return checks
  }

  // The one check that reads the whole configuration. A broken overlay makes
  // `up` fail with a message about YAML rather than about the gateway, and it
  // is checked directly so failures name the configuration boundary.
  const rendered = await runProcess('docker', ['compose', ...composeArguments(context), 'config', '--quiet'], {
    cwd: root,
    env: env as NodeJS.ProcessEnv,
    reject: false,
  })
  add(
    rendered.failed
      ? check(
          'config.compose',
          'fail',
          'compose configuration',
          `the ${config.profile} profile does not render`,
          'portta inspect   shows the file list; the error is above',
        )
      : check('config.compose', 'pass', 'compose configuration', `renders for the ${config.profile} profile`),
  )

  const containers = await inspectContainers()
  const running = containers.filter((container) => container.state === 'running')

  // --- networks ------------------------------------------------------------
  const shared = await networkFacts(config.network)
  if (shared.exists) {
    add(check('network.shared', 'pass', 'shared network', `${config.network} (${shared.endpoints} attached)`))
    add(
      shared.managed
        ? check('network.shared.owned', 'pass', 'shared network ownership', 'created by the gateway')
        : check(
            'network.shared.owned',
            'warn',
            'shared network ownership',
            `'${config.network}' has no portta.managed label`,
            'harmless: the gateway will never remove a network it does not own',
          ),
    )
  } else {
    add(check('network.shared', 'fail', 'shared network', `'${config.network}' does not exist`, 'portta bootstrap'))
  }

  const controlName = env.PORTTA_CONTROL_NETWORK || `${config.network}-control`
  const control = await networkFacts(controlName)
  add(
    !control.exists
      ? check('network.control', 'warn', 'control network', 'not created yet', `portta up ${config.profile}`)
      : control.internal
        ? check('network.control', 'pass', 'control network', `${controlName} (internal)`)
        : check(
            'network.control',
            'fail',
            'control network',
            `${controlName} is not marked internal`,
            'the Docker socket proxy must sit on an internal network; recreate the gateway',
          ),
  )

  // --- gateway components --------------------------------------------------
  const traefik = gatewayContainer(containers, 'traefik')
  if (!traefik) {
    add(check('traefik.state', 'warn', 'traefik', 'container not created', `portta up ${config.profile}`))
  } else {
    add(
      traefik.state === 'running' && traefik.health === 'healthy'
        ? check('traefik.state', 'pass', 'traefik', 'running and healthy')
        : traefik.state === 'running'
          ? check(
              'traefik.state',
              'warn',
              'traefik',
              `running, health=${traefik.health ?? 'none'}`,
              'portta logs traefik',
            )
          : check('traefik.state', 'fail', 'traefik', `state=${traefik.state}`, `portta up ${config.profile}`),
    )
    add(imageTagVerdict(traefik.image))
    // Traefik must reach Docker only through the socket proxy.
    add(
      (traefik.mounts ?? []).some((mount) => mount.source.includes('docker.sock'))
        ? check(
            'traefik.socket',
            'fail',
            'docker socket',
            'the Docker socket is mounted into Traefik',
            'remove the bind mount; Traefik must use the socket proxy on the control network',
          )
        : check('traefik.socket', 'pass', 'docker socket', 'not mounted into Traefik'),
    )
  }

  const proxy = gatewayContainer(containers, 'socket-proxy')
  if (!proxy) {
    add(check('proxy.state', 'warn', 'docker socket proxy', 'container not created', `portta up ${config.profile}`))
  } else {
    add(
      proxy.state === 'running'
        ? check('proxy.state', 'pass', 'docker socket proxy', 'running')
        : check('proxy.state', 'fail', 'docker socket proxy', `state=${proxy.state}`, `portta up ${config.profile}`),
    )
    const published = publishedBindings(proxy)
    add(
      published
        ? check(
            'proxy.exposure',
            'fail',
            'docker socket proxy exposure',
            `publishes host ports: ${published}`,
            'the Docker API must never be reachable from the host or the network',
          )
        : check('proxy.exposure', 'pass', 'docker socket proxy exposure', 'no host ports published'),
    )
    const socket = (proxy.mounts ?? []).find((mount) => mount.source.includes('docker.sock'))
    add(
      !socket
        ? check('proxy.socket', 'warn', 'docker socket mount', 'could not determine mount mode')
        : socket.readWrite
          ? check(
              'proxy.socket',
              'fail',
              'docker socket mount',
              'mounted read-write',
              'mount /var/run/docker.sock read-only (:ro)',
            )
          : check('proxy.socket', 'pass', 'docker socket mount', 'read-only'),
    )
  }

  // The panel's database is one SQLite file under state/panel (ADR 0037): no
  // container, no port and no network to check. The panel creates it on its
  // first boot, so a missing file matters only once the panel is enabled.
  if (config.webEnabled) {
    const databaseFile = databaseFileFor(root)
    add(
      existsSync(databaseFile)
        ? check('db.file', 'pass', 'panel database', databaseFile)
        : check(
            'db.file',
            'warn',
            'panel database',
            `${databaseFile} not created yet; the panel creates it on first boot`,
            'portta web up',
          ),
    )
  }

  // --- exposure ------------------------------------------------------------
  const panelIsPublic = (env.PORTTA_WEB_EXPOSE || 'local') === 'public'
  if (traefik && traefik.state === 'running') {
    const binds = bindMap(traefik)
    add(check('exposure.binds', 'pass', 'published ports', binds || 'none'))
    add(exposureVerdict(config.profile, binds, panelIsPublic))
  }

  // Anything the gateway owns must not publish a sensitive port publicly.
  for (const container of running.filter((entry) => entry.labels['portta.managed'] === 'true')) {
    const published = publishedWithTargets(container)
    if (publishesSensitivePort(published)) {
      add(
        check(
          'exposure.sensitive',
          'fail',
          'sensitive port exposure',
          `${container.name} publishes a database or Docker API port on all interfaces: ${published}`,
          'bind it to 127.0.0.1 or remove the published port',
        ),
      )
    }
  }

  // --- tailscale -----------------------------------------------------------
  const attached = config.profile !== 'local' && config.tailscaleEnabled ? 'tailscale' : 'host'
  add(check('config.attachment', 'pass', 'traefik attachment', attached))
  if (attached === 'tailscale') {
    const sidecar = gatewayContainer(containers, 'tailscale')
    if (!sidecar) {
      add(check('tailscale.state', 'warn', 'tailscale', 'container not created', `portta up ${config.profile}`))
    } else {
      if (sidecar.state === 'running' && sidecar.health === 'healthy') {
        const address = await runProcess('docker', ['exec', sidecar.id, 'tailscale', 'ip', '-4'], { reject: false })
        const ip = address.failed ? '' : (address.stdout.trim().split('\n')[0] ?? '')
        add(
          ip
            ? check('tailscale.state', 'pass', 'tailscale', `connected as ${ip}`)
            : check(
                'tailscale.state',
                'fail',
                'tailscale',
                'running but has no tailnet address',
                "check TS_AUTHKEY and the tailnet's device approval settings",
              ),
        )
      } else {
        add(
          check(
            'tailscale.state',
            'fail',
            'tailscale',
            `state=${sidecar.state} health=${sidecar.health ?? ''}`,
            'portta logs tailscale',
          ),
        )
      }
      // Traefik must actually be inside that namespace, or the gateway is not
      // on the tailnet at all and nothing is reachable.
      if (traefik) {
        add(
          traefik.networkMode?.startsWith('container:')
            ? check('tailscale.netns', 'pass', 'traefik network namespace', 'shared with tailscale')
            : check(
                'tailscale.netns',
                'fail',
                'traefik network namespace',
                `traefik is not in the tailscale namespace (${traefik.networkMode ?? 'unknown'})`,
                `portta up ${config.profile}`,
              ),
        )
      }
      // State has to survive a restart or the node identity churns.
      add(
        existsSync(join(stateDir, 'tailscale'))
          ? check('tailscale.state.dir', 'pass', 'tailscale state', 'persisted under state/tailscale')
          : check('tailscale.state.dir', 'warn', 'tailscale state', 'state directory missing', 'portta bootstrap'),
      )
    }
    const hasKey = Boolean(env.TS_AUTHKEY)
    add(
      !hasKey && !existsSync(join(stateDir, 'tailscale/tailscaled.state'))
        ? check(
            'tailscale.authkey',
            'fail',
            'tailscale auth',
            'no TS_AUTHKEY and no persisted state',
            'set TS_AUTHKEY in .env; prefer an ephemeral, tagged, pre-authorized key',
          )
        : check('tailscale.authkey', 'pass', 'tailscale auth', hasKey ? 'auth key set' : 'using persisted state'),
    )
  }

  // --- dashboard -----------------------------------------------------------
  add(
    dashboardVerdict(
      config.dashboardEnabled,
      env.PORTTA_DASHBOARD_BIND_ADDRESS || '127.0.0.1',
      env.PORTTA_DASHBOARD_PORT || '8080',
    ),
  )
  // --- the panel's front door ----------------------------------------------
  const webBind = env.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1'
  const webPort = env.PORTTA_WEB_PORT || '8081'
  if (config.webEnabled) {
    add(
      ...panelAuthVerdicts({
        expose: env.PORTTA_WEB_EXPOSE || 'local',
        bindAddress: webBind,
        port: webPort,
        authMode: env.PORTTA_AUTH_MODE || 'disabled',
        secretPresent: Boolean(env.PORTTA_AUTH_SECRET),
        readOnly: isTrue(env.PORTTA_WEB_READ_ONLY),
        allowLan: isTrue(env.PORTTA_AUTH_ALLOW_LAN),
      }),
    )
  }

  // --- authentication boundary ---------------------------------------------
  add(
    env.PORTTA_AUTH_SECRET
      ? check('auth.secret', 'pass', 'authentication signing secret', 'set')
      : check(
          'auth.secret',
          'fail',
          'authentication signing secret',
          'PORTTA_AUTH_SECRET is unset',
          'portta bootstrap   (generates it without printing it)',
        ),
  )

  // `portta bootstrap` runs this before anything has ever been started, so a
  // component that does not exist yet is a warning and not a failure — the same
  // rule traefik.state follows. Only a gateway that HAS an auth container and
  // no store is broken rather than unstarted.
  const auth = gatewayContainer(containers, 'auth')
  const authStore = join(root, 'state/auth/protections.json')
  add(authStoreVerdict(existsSync(authStore), fileMode(authStore), Boolean(auth)))
  add(
    componentVerdict(
      'auth.service',
      'authentication service',
      Boolean(auth),
      auth?.state ?? null,
      auth?.health ?? null,
      'portta logs portta-auth',
    ),
  )

  // --- issues --------------------------------------------------------------
  // The panel reads and writes issues through `gh` on this host, so this is a
  // check about this machine rather than about the panel's configuration
  // (docs/development/adr/0018-github-issues-through-the-gh-cli.md). It never
  // fails: a Portta used only for environments needs neither provider, and a
  // failure would make `portta doctor` exit 1 on a host that is fine.
  const gh = await locate('gh')
  if (!gh) {
    add(
      check(
        'issues.gh',
        'warn',
        'github cli',
        'gh is not installed, so the panel cannot read or write issues',
        'install it from https://cli.github.com, then gh auth login',
      ),
    )
  } else {
    const authed = await runProcess('gh', ['auth', 'status'], { reject: false })
    add(
      authed.failed
        ? check('issues.gh', 'warn', 'github cli', 'gh is installed but nobody is signed in', 'gh auth login')
        : check('issues.gh', 'pass', 'github cli', `signed in (${gh})`),
    )
  }
  if (env.LINEAR_API_KEY) add(check('issues.linear', 'pass', 'linear', 'LINEAR_API_KEY is set for the host daemon'))

  // --- databases by hostname -----------------------------------------------
  if (config.tcpEnabled) {
    add(
      config.profile === 'remote-public'
        ? check(
            'tcp.profile',
            'fail',
            'tcp entrypoints',
            'enabled on the remote-public profile, where Traefik binds every interface',
            'set PORTTA_TCP=false; reach databases over the VPN or a loopback bridge',
          )
        : check(
            'tcp.profile',
            'pass',
            'tcp entrypoints',
            `postgres :${env.PORTTA_TCP_POSTGRES_PORT || 5432}, redis :${env.PORTTA_TCP_REDIS_PORT || 6379} on ${config.bindAddress}`,
          ),
    )

    // The hostname travels inside the TLS handshake, so a client that does not
    // ask for TLS cannot be routed at all. Without a configured certificate
    // Traefik serves a self-signed one, which `sslmode=require` accepts and
    // `verify-full` does not.
    add(
      config.tlsEnabled
        ? check('tcp.tls', 'pass', 'tcp tls', `certificates configured (${config.tlsMode})`)
        : check(
            'tcp.tls',
            'warn',
            'tcp tls',
            'no certificate configured; Traefik will serve a self-signed one',
            'sslmode=require works; for verify-full run: portta tls init',
          ),
    )

    // A routed datastore belongs on the access network. On the shared one it
    // would be reachable by every HTTP service on the host.
    const routed = running.filter((container) =>
      Object.keys(container.labels).some((key) => key.startsWith('traefik.tcp.routers.')),
    )
    const onShared = routed
      .filter((container) => container.networks.includes(config.network))
      .map((container) => container.name)
    add(
      onShared.length > 0
        ? check(
            'tcp.network',
            'fail',
            'routed datastores',
            `on the shared HTTP network: ${onShared.join(' ')}`,
            `attach them to ${env.PORTTA_ACCESS_NETWORK || `${config.network}-access`} instead; see docs/product/guides/tcp-routing.md`,
          )
        : check('tcp.network', 'pass', 'routed datastores', `${routed.length} routed, none on the shared network`),
    )
  } else {
    add(check('tcp.profile', 'pass', 'tcp entrypoints', 'disabled'))
  }

  // --- web panel -----------------------------------------------------------
  // The panel can start, stop and remove containers, so where it listens
  // matters more than for anything else the gateway runs.
  if (config.webEnabled) {
    const web = gatewayContainer(containers, 'web')
    if (panelIsPublic) {
      // The panel container publishes nothing in this mode: the address belongs
      // to Traefik's `panel` entrypoint, and web.auth proves what is in front
      // of it. What would be wrong here is a second, unauthenticated door.
      const ownPorts = web ? publishedBindings(web) : ''
      add(
        ownPorts
          ? check(
              'web.bind',
              'fail',
              'web panel',
              `published directly on the host at ${ownPorts}, bypassing the authenticating entrypoint`,
              'remove the ports: entry; docker/compose/features/panel-public.yaml owns this port',
            )
          : check(
              'web.bind',
              'pass',
              'web panel',
              `reached only through Traefik's authenticated panel entrypoint on ${webBind}:${webPort}`,
            ),
      )
    } else if (isLoopbackAddress(webBind)) {
      add(check('web.bind', 'pass', 'web panel', `enabled on ${webBind}:${webPort} (loopback)`))
    } else if (isWildcardAddress(webBind)) {
      add(
        check(
          'web.bind',
          'fail',
          'web panel',
          `enabled and bound to ${webBind} with nothing authenticating it`,
          'portta config set panel.access public   (or set PORTTA_WEB_BIND_ADDRESS=127.0.0.1)',
        ),
      )
    } else {
      add(
        check(
          'web.bind',
          'pass',
          'web panel',
          `enabled on ${webBind}:${webPort} (access: ${env.PORTTA_WEB_EXPOSE || 'local'})`,
        ),
      )
    }

    if (env.PORTTA_WEB_EXPOSE === 'vpn' && config.profile === 'remote-public') {
      add(
        check(
          'web.expose',
          'fail',
          'web panel routing',
          'routed on the tailnet hostname while Traefik answers the internet',
          'portta web up --expose domain, or set PORTTA_WEB_EXPOSE=local',
        ),
      )
    }
    // `domain` is routed deliberately, so what is worth checking is that the
    // router and the credential name the same host: they are written from the
    // same setting, and a mismatch fails the panel closed rather than open.
    if (env.PORTTA_WEB_EXPOSE === 'domain') {
      const advertised = env.PORTTA_PANEL_ADVERTISED_HOST ?? ''
      add(
        config.tlsEnabled
          ? check('web.expose', 'pass', 'web panel routing', `routed on ${advertised} over HTTPS`)
          : check(
              'web.expose',
              'fail',
              'web panel routing',
              'routed on the domain with TLS off, so the credential crosses in clear text',
              'portta config set tls.enabled true',
            ),
      )
    }
    add(
      !web
        ? check('web.state', 'warn', 'web panel container', 'not running', 'portta web up')
        : web.state === 'running'
          ? check('web.state', 'pass', 'web panel container', `${web.state} (${web.health ?? 'none'})`)
          : check('web.state', 'warn', 'web panel container', web.state, 'portta web up'),
    )

    const webProxy = gatewayContainer(containers, 'web-socket-proxy')
    if (webProxy) {
      const ports = publishedBindings(webProxy)
      add(
        ports
          ? check(
              'web.proxy',
              'fail',
              'web panel socket proxy',
              `published on the host: ${ports}`,
              'it must be reachable only from the panel; do not add a ports: entry to docker/compose/features/web.yaml',
            )
          : check('web.proxy', 'pass', 'web panel socket proxy', 'unpublished, reachable only from the panel'),
      )
    }
  } else {
    add(check('web.bind', 'pass', 'web panel', 'disabled'))
  }

  // --- DNS and TLS ---------------------------------------------------------
  add(check('domain.mode', 'pass', 'project domain mode', `${config.domainMode} (*.${config.domain})`))
  if (config.domainProblem) {
    add(check('domain.resolved', 'fail', 'project domain', config.domainProblem, 'portta config set domain.mode auto'))
  }
  add(...(await domainChecks(config, env)))

  if (config.tlsEnabled) {
    if (config.tlsMode === 'acme') {
      const overHttp = config.acmeChallenge === 'http'
      add(
        env.ACME_EMAIL
          ? check(
              'tls.acme',
              'pass',
              'ACME configuration',
              overHttp ? `${env.ACME_EMAIL} over HTTP-01` : `${env.ACME_EMAIL} via ${env.ACME_DNS_PROVIDER ?? ''}`,
            )
          : check('tls.acme', 'fail', 'ACME configuration', 'ACME_EMAIL is not set', 'set ACME_EMAIL in .env'),
      )
      // Each challenge fails for its own reason, and both failures look the
      // same from outside: no certificate, and a browser warning.
      if (overHttp) {
        add(
          check(
            'tls.acme.challenge',
            'pass',
            'ACME challenge',
            'HTTP-01: one certificate per hostname, issued on first request',
          ),
        )
        add(
          config.bindAddress === '0.0.0.0'
            ? check('tls.acme.reachable', 'pass', 'ACME reachability', ':80 is bound on every interface')
            : check(
                'tls.acme.reachable',
                'fail',
                'ACME reachability',
                `HTTP-01 needs :80 reachable from the internet, and Traefik binds ${config.bindAddress}`,
                'portta public enable, or use ACME_CHALLENGE=dns',
              ),
        )
      } else {
        add(check('tls.acme.challenge', 'pass', 'ACME challenge', `DNS-01: one wildcard for *.${config.domain}`))
        add(
          env.CF_DNS_API_TOKEN
            ? check('tls.acme.credential', 'pass', 'ACME DNS credential', 'CF_DNS_API_TOKEN is set')
            : check(
                'tls.acme.credential',
                'fail',
                'ACME DNS credential',
                'DNS-01 cannot issue anything without a provider credential',
                'set CF_DNS_API_TOKEN, or use ACME_CHALLENGE=http for per-hostname certificates',
              ),
        )
      }
      const store = join(stateDir, 'traefik/acme/acme.json')
      if (existsSync(store)) {
        const mode = fileMode(store)
        add(
          mode === '600'
            ? check('tls.acme.perms', 'pass', 'ACME store permissions', mode)
            : check(
                'tls.acme.perms',
                'fail',
                'ACME store permissions',
                `${mode ?? 'unknown'} is too permissive`,
                'chmod 600 state/traefik/acme/acme.json',
              ),
        )
      } else {
        add(check('tls.acme.store', 'warn', 'ACME store', 'no certificate has been issued yet'))
      }
    } else if (config.tlsMode === 'local') {
      add(check('tls.local', 'pass', 'TLS', 'local certificate mode'))
    } else {
      add(check('tls.mode', 'fail', 'TLS mode', `unknown TLS_MODE '${config.tlsMode}'`, 'use TLS_MODE=local or acme'))
    }
  } else {
    add(check('tls.disabled', 'pass', 'TLS', 'disabled (plain HTTP)'))
  }

  // --- routing and consumers -----------------------------------------------
  const routes = routesFor(running, config.domain, config.tlsEnabled ? 'https' : 'http')
  add(check('routes.count', 'pass', 'routed services', String(routes.length)))

  const collisions = duplicates(routes.map((route) => route.hostname))
  add(
    collisions.length > 0
      ? check(
          'routes.collision',
          'fail',
          'hostname collisions',
          `more than one service resolves to: ${collisions.join(' ')}`,
          'give the projects distinct COMPOSE_PROJECT_NAME values',
        )
      : check('routes.collision', 'pass', 'hostname collisions', 'none'),
  )

  const routable = running.filter((container) => container.labels['traefik.enable'] === 'true')
  const uninterpolated = routable
    .filter((container) => hasUninterpolatedLabel(container.labels))
    .map((container) => container.name)
  add(
    uninterpolated.length > 0
      ? check(
          'labels.interpolation',
          'fail',
          'Traefik label interpolation',
          `labels still contain a literal \${...}: ${uninterpolated.join(' ')}`,
          'write those labels in list form (- "key=value"); Compose does not interpolate mapping keys',
        )
      : check('labels.interpolation', 'pass', 'Traefik label interpolation', 'no literal ${...} in labels'),
  )

  // Traefik service names are one flat namespace for the whole host. Two
  // projects declaring the same name are merged into a single load balancer,
  // which silently sends one project's traffic to the other.
  const perProject = new Map<string, Set<string>>()
  for (const container of routable) {
    const project = container.labels['com.docker.compose.project'] ?? container.name
    const names = perProject.get(project) ?? new Set<string>()
    for (const name of traefikServiceNames(container.labels)) names.add(name)
    perProject.set(project, names)
  }
  const sharedNames = duplicates([...perProject.values()].flatMap((names) => [...names]))
  add(
    sharedNames.length > 0
      ? check(
          'services.collision',
          'fail',
          'Traefik service name collisions',
          `shared across projects: ${sharedNames.join(' ')}`,
          'prefix each Traefik service name with the project namespace',
        )
      : check('services.collision', 'pass', 'Traefik service name collisions', 'none'),
  )

  if (shared.exists) {
    const risky = running
      .filter((container) => container.networks.includes(config.network) && looksLikeDatastore(container.image))
      .map((container) => container.name)
    add(
      risky.length > 0
        ? check(
            'network.datastores',
            'warn',
            'datastores on the shared network',
            `attached: ${risky.join(' ')}`,
            "databases and caches belong on the project's private network only; see docs/product/concepts/networking.md",
          )
        : check('network.datastores', 'pass', 'datastores on the shared network', 'none'),
    )
  }

  // --- TCP access ----------------------------------------------------------
  const bridges = running.filter((container) => container.labels['portta.component'] === 'access-bridge')
  add(check('access.bridges', 'pass', 'open access bridges', String(bridges.length)))

  // A bridge is a hole into a project's private network. It must stay on
  // loopback, or the database it fronts is on the local network.
  const badBinds = bridges
    .filter((bridge) => bridge.ports.some((port) => port.publicPort !== null && isWildcardAddress(port.ip)))
    .map((bridge) => bridge.labels['portta.access.id'] ?? bridge.name)
  add(
    badBinds.length > 0
      ? check(
          'access.binds',
          'fail',
          'access bridge binds',
          `bound beyond loopback: ${badBinds.join(' ')}`,
          'close them and reopen without --bind, or with --bind 127.0.0.1',
        )
      : check('access.binds', 'pass', 'access bridge binds', 'loopback only'),
  )

  // A bridge whose target is gone forwards nowhere and should be collected.
  const stale = bridges
    .filter((bridge) => {
      const project = bridge.labels['portta.access.project']
      const service = bridge.labels['portta.access.service']
      return !running.some(
        (container) =>
          container.labels['com.docker.compose.project'] === project &&
          container.labels['com.docker.compose.service'] === service,
      )
    })
    .map((bridge) => bridge.labels['portta.access.id'] ?? bridge.name)
  add(
    stale.length > 0
      ? check('access.stale', 'warn', 'stale access bridges', `target gone: ${stale.join(' ')}`, 'portta access gc')
      : check('access.stale', 'pass', 'stale access bridges', 'none'),
  )

  // A forwarder on the shared HTTP network would make a database reachable by
  // every project on the host, which is exactly what the access network avoids.
  const forwarders = running.filter((container) => container.labels['portta.component'] === 'access-forwarder')
  const leaky = forwarders
    .filter((forwarder) => forwarder.networks.includes(config.network))
    .map((forwarder) => forwarder.labels['portta.forward.alias'] ?? forwarder.name)
  add(
    leaky.length > 0
      ? check(
          'access.forwarder.network',
          'fail',
          'published forwarders',
          `attached to the shared HTTP network: ${leaky.join(' ')}`,
          `a forwarder belongs on the project network and ${env.PORTTA_ACCESS_NETWORK || `${config.network}-access`} only`,
        )
      : check(
          'access.forwarder.network',
          'pass',
          'published forwarders',
          `${forwarders.length} on the access network only`,
        ),
  )

  // --- orphans owned by the gateway ----------------------------------------
  const orphans = containers
    .filter(
      (container) => container.labels['portta.managed'] === 'true' && ['exited', 'dead'].includes(container.state),
    )
    .map((container) => container.name)
  add(
    orphans.length > 0
      ? check(
          'orphans',
          'warn',
          'stopped gateway containers',
          orphans.join(' '),
          `portta up ${config.profile}  (or remove them explicitly)`,
        )
      : check('orphans', 'pass', 'stopped gateway containers', 'none'),
  )

  // --- panel access --------------------------------------------------------
  // How the panel is reached is a security decision, so it is checked rather
  // than merely reported. See docs/development/adr/0021-panel-access-modes.md.
  if (config.webEnabled) {
    const expose = env.PORTTA_WEB_EXPOSE || 'local'
    add(
      ['local', 'tailscale', 'public', 'vpn', 'domain'].includes(expose)
        ? check('panel.access', 'pass', 'panel access', `${expose} (bind ${webBind}:${webPort})`)
        : check(
            'panel.access',
            'fail',
            'panel access',
            `unknown mode '${expose}'`,
            'portta config set panel.access public|tailscale|local',
          ),
    )
  }

  // --- development environment ---------------------------------------------
  // Reported, never changed. Nothing below can fail the run.
  add(...environmentChecks.filter((entry) => entry.id !== 'runtime.docker'))

  const tailscaleBinary = await locate('tailscale')
  if (!tailscaleBinary) {
    add(
      check(
        'vpn.tailscale',
        'warn',
        'tailscale',
        'not found',
        'optional; the panel can also be reached publicly or over an SSH tunnel',
      ),
    )
  } else {
    const address = await version(tailscaleBinary, ['ip', '-4'])
    add(
      address
        ? check('vpn.tailscale', 'pass', 'tailscale', `connected (${address})`)
        : check(
            'vpn.tailscale',
            'warn',
            'tailscale',
            'installed but not connected',
            'tailscale up   (run it yourself; Portta never authenticates it for you)',
          ),
    )
  }

  // --- official modules ----------------------------------------------------
  add(...(await moduleDoctorChecks(context, CLI_MODULES)))

  return checks
}

/**
 * Whether the hostnames the gateway derives actually reach it.
 *
 * A name that resolves somewhere else produces URLs that load somebody else's
 * site, which is worse than a URL that fails — so a wildcard pointing away from
 * this host is a failure, while an unexposed one is a warning: exposure is a
 * separate, deliberate decision.
 */
async function domainChecks(
  config: GatewayContext['config'],
  env: Record<string, string | undefined>,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  const domain = config.domain
  const panelExpose = env.PORTTA_WEB_EXPOSE || 'local'

  if (domain === 'localhost' || domain.endsWith('.localhost')) {
    // RFC 6761 reserves `localhost`; resolvers must map it to loopback.
    checks.push(localhostDnsVerdict(await resolveIpv4('portta-probe.localhost')))
    // A loopback name on a host reached from elsewhere is a URL nobody can
    // open, which is the failure docs/development/adr/0022 exists to catch.
    if (panelExpose !== 'local') {
      checks.push(
        check(
          'domain.reachable',
          'warn',
          'project hostnames',
          '*.localhost only resolves on this machine, and the panel is reached from elsewhere',
          'portta config set domain.mode auto',
        ),
      )
    }
    return checks
  }

  checks.push(check('dns.domain', 'pass', 'domain', domain))
  // A name that can only match the wildcard, so a stray apex A record cannot
  // make a broken wildcard look healthy.
  const resolved = (await resolveIpv4(`portta-probe.${domain}`))[0]
  if (!resolved) {
    checks.push(check('dns.wildcard', 'fail', 'wildcard DNS', `*.${domain} does not resolve`, 'portta dns setup'))
  } else if (isLoopbackIp(resolved)) {
    // A local resolver or a public record for 127.0.0.1: this machine, and no
    // public address to compare against.
    checks.push(check('dns.wildcard', 'pass', 'wildcard DNS', `*.${domain} -> ${resolved} (this machine)`))
  } else {
    const expected = env.PORTTA_PUBLIC_IP ?? ''
    checks.push(
      !expected
        ? check('dns.wildcard', 'pass', 'wildcard DNS', `*.${domain} -> ${resolved}`)
        : resolved === expected
          ? check('dns.wildcard', 'pass', 'wildcard DNS', `*.${domain} -> ${resolved} (this host)`)
          : // Not a failure: a proxied domain resolves to the proxy by design, and
            // Cloudflare's orange cloud is the ordinary case. The record being
            // stale is the other cause, and only the operator can tell them apart
            // -- so name both rather than assert the wrong one.
            check(
              'dns.wildcard',
              'warn',
              'wildcard DNS',
              `*.${domain} -> ${resolved}, and this host is ${expected}`,
              'normal behind a proxy or CDN that forwards here; otherwise point the wildcard at this host, or refresh the address: portta config set domain.mode auto',
            ),
    )
  }

  const bind = config.bindAddress
  const loopback = resolved ? loopbackDomainVerdict(domain, resolved, bind) : null
  if (loopback) {
    checks.push(loopback)
    if (panelExpose !== 'local') {
      checks.push(
        check(
          'domain.reachable.remote',
          'warn',
          'project hostnames',
          `*.${domain} resolves to loopback, and the panel is reached from elsewhere`,
          'point the wildcard at this host, or portta config set domain.mode auto',
        ),
      )
    }
  } else if (isLoopbackAddress(bind)) {
    // A name that resolves to a tailnet or LAN address is served by binding
    // that address. Suggesting public exposure there would be a far larger
    // change than the one actually needed.
    const publicIp = env.PORTTA_PUBLIC_IP ?? ''
    const fix =
      publicIp && isPrivateAddress(publicIp)
        ? `portta config set gateway.bindAddress ${publicIp}   serves them on that network only`
        : 'portta public enable   exposes the HTTP services that opted in'
    checks.push(
      check(
        'domain.reachable',
        'warn',
        'project hostnames',
        `*.${domain} points here, but Traefik listens on ${bind} only`,
        fix,
      ),
    )
  } else {
    checks.push(check('domain.reachable', 'pass', 'project hostnames', `*.${domain}, served on ${bind}`))
  }
  return checks
}

/** One DNS lookup, with no dependency on `dig` being installed. */
async function resolveIpv4(hostname: string): Promise<string[]> {
  try {
    const { resolve4, lookup } = await import('node:dns/promises')
    try {
      return await resolve4(hostname)
    } catch {
      // `localhost` and anything in /etc/hosts is not in DNS at all; the
      // resolver's own view is the honest answer for those.
      const found = await lookup(hostname, { family: 4, all: true })
      return found.map((entry) => entry.address)
    }
  } catch {
    return []
  }
}
