import { describe, expect, it } from 'vitest'
import {
  applicationBinds,
  authStoreVerdict,
  componentVerdict,
  dashboardVerdict,
  environmentToolVerdict,
  envPermissionVerdict,
  exposureVerdict,
  localhostDnsVerdict,
  loopbackDomainVerdict,
  meetsMinimum,
  panelAuthVerdicts,
  publishesSensitivePort,
  versionMajor,
} from './diagnostics.ts'

describe('environment readiness verdicts', () => {
  const present = {
    installed: true,
    path: '/usr/bin/tool',
    version: '1.2.3',
    onPath: true,
    usable: true,
  }

  it('distinguishes an optional absence from a broken required tool', () => {
    const absent = { installed: false, path: null, version: null, onPath: false, usable: false }
    expect(
      environmentToolVerdict(absent, {
        id: 'optional',
        title: 'optional',
        category: 'agents',
        optional: true,
      }).status,
    ).toBe('info')
    expect(
      environmentToolVerdict(absent, {
        id: 'required',
        title: 'required',
        category: 'infrastructure',
      }).status,
    ).toBe('fail')
  })

  it('keeps installation, version, path and usability as separate facts', () => {
    const verdict = environmentToolVerdict(
      { ...present, onPath: false },
      {
        id: 'tool',
        title: 'Tool',
        category: 'development',
        minimum: '1',
        recommended: '2',
      },
    )
    expect(verdict).toMatchObject({
      status: 'warn',
      tool: { installed: true, version: '1.2.3', path: '/usr/bin/tool', minimum: '1', recommended: '2' },
    })
    expect(verdict.detail).toMatch(/not on this PATH/)
  })
})

describe('version comparison', () => {
  it('answers null rather than 0 for something that is not a version', () => {
    expect(versionMajor('unknown')).toBeNull()
    expect(versionMajor('')).toBeNull()
  })

  // A missing version must not read as "old enough": that would pass a check
  // on a daemon nobody could reach.
  it('never meets a minimum it cannot read', () => {
    expect(meetsMinimum('unknown', 24)).toBe(false)
    expect(meetsMinimum('23.0.1', 24)).toBe(false)
    expect(meetsMinimum('24.0.0', 24)).toBe(true)
  })
})

describe('.env permissions', () => {
  it('passes only when nothing outside the owner can read it', () => {
    expect(envPermissionVerdict('600').status).toBe('pass')
    expect(envPermissionVerdict('400').status).toBe('pass')
    expect(envPermissionVerdict('700').status).toBe('pass')
  })

  it('warns for group- or world-readable, and names the fix', () => {
    for (const mode of ['644', '640', '664', '666', '604']) {
      const verdict = envPermissionVerdict(mode)
      expect(verdict.status, mode).toBe('warn')
      expect(verdict.fix).toBe('chmod 600 .env')
    }
  })

  it('says so rather than guessing when the mode cannot be read', () => {
    expect(envPermissionVerdict(null).status).toBe('warn')
  })
})

describe('local name resolution', () => {
  // A wildcard DNS server or a search domain can answer for `*.localhost`; a
  // non-empty answer is not the same as a loopback one.
  it('passes *.localhost only when every answer is loopback', () => {
    expect(localhostDnsVerdict(['127.0.0.1']).status).toBe('pass')
    expect(localhostDnsVerdict(['203.0.113.7']).status).toBe('warn')
    expect(localhostDnsVerdict([]).status).toBe('warn')
  })

  // A custom domain pointed at 127.0.0.1 is served by the default loopback
  // bind. The generic advice for a loopback bind is `portta public enable`,
  // which would expose services to fix a name that already works.
  it('serves a domain that resolves to loopback without suggesting exposure', () => {
    const served = loopbackDomainVerdict('portta.test', '127.0.0.1', '127.0.0.1')
    expect(served?.status).toBe('pass')
    expect(served?.fix ?? '').not.toContain('public enable')
    expect(loopbackDomainVerdict('portta.test', '127.0.0.1', '100.64.0.10')?.status).toBe('warn')
    expect(loopbackDomainVerdict('dev.example.com', '203.0.113.7', '127.0.0.1')).toBeNull()
  })
})

describe('exposure', () => {
  const loopback = '80/tcp=127.0.0.1:80 443/tcp=127.0.0.1:443'
  const everywhere = '80/tcp=0.0.0.0:80 443/tcp=0.0.0.0:443'

  it('fails a local profile that publishes an application on every interface', () => {
    expect(exposureVerdict('local', everywhere, false)?.status).toBe('fail')
    expect(exposureVerdict('local', loopback, false)?.status).toBe('pass')
  })

  // The panel's own entrypoint is public on purpose in `public` access mode,
  // and is the one port that is authenticated. Judging it as an application
  // entrypoint would make a correct configuration read as a finding.
  it('leaves the authenticated panel entrypoint out of the application verdict', () => {
    const withPanel = `${loopback} 8090/tcp=0.0.0.0:8443`
    expect(applicationBinds(withPanel, true)).toBe(loopback)
    expect(applicationBinds(withPanel, false)).toBe(withPanel)
    expect(exposureVerdict('local', withPanel, true)?.status).toBe('pass')
    expect(exposureVerdict('local', withPanel, false)?.status).toBe('fail')
  })

  it('fails a private profile bound to every interface', () => {
    expect(exposureVerdict('remote-private', everywhere, false)?.status).toBe('fail')
    expect(exposureVerdict('remote-private', loopback, false)?.status).toBe('pass')
  })

  // Public is a decision, not an accident: it warns so the reader sees it, and
  // never fails, because that is what the profile was chosen for.
  it('warns rather than fails on the public profile', () => {
    expect(exposureVerdict('remote-public', everywhere, false)?.status).toBe('warn')
  })
})

describe('sensitive ports', () => {
  it('catches a database or the Docker API published on every interface', () => {
    for (const port of ['5432/tcp', '3306/tcp', '6379/tcp', '27017/tcp', '2375/tcp', '2376/tcp']) {
      expect(publishesSensitivePort(`0.0.0.0:9999->${port}`), port).toBe(true)
    }
  })

  it('leaves a loopback publish alone, which is how every bridge works', () => {
    expect(publishesSensitivePort('127.0.0.1:55432->5432/tcp')).toBe(false)
  })

  it('does not fire on an ordinary HTTP port', () => {
    expect(publishesSensitivePort('0.0.0.0:8080->8080/tcp')).toBe(false)
  })
})

describe('the Traefik dashboard', () => {
  // It exposes the routing internals of every project on the host, so
  // anything but loopback is a failure rather than a warning.
  it('fails anywhere but loopback, and passes when it is off', () => {
    expect(dashboardVerdict(false, '0.0.0.0', '8080').status).toBe('pass')
    expect(dashboardVerdict(true, '127.0.0.1', '8080').status).toBe('pass')
    expect(dashboardVerdict(true, '::1', '8080').status).toBe('pass')
    expect(dashboardVerdict(true, '0.0.0.0', '8080').status).toBe('fail')
    expect(dashboardVerdict(true, '100.87.243.7', '8080').status).toBe('fail')
  })
})

describe('the panel front door', () => {
  const base = {
    expose: 'local',
    bindAddress: '127.0.0.1',
    port: '8081',
    authMode: 'disabled',
    secretPresent: false,
    readOnly: false,
  }
  const byId = (checks: ReturnType<typeof panelAuthVerdicts>) =>
    Object.fromEntries(checks.map((entry) => [entry.id, entry]))

  it('needs nobody to sign in on loopback', () => {
    expect(byId(panelAuthVerdicts(base))['web.auth']?.status).toBe('pass')
  })

  // The tailnet authenticates on its own: a node is a device somebody enrolled.
  // So this is a choice rather than a hole — but never an invisible one.
  it('warns, rather than fails, a tailnet panel that asks nobody who they are', () => {
    const checks = byId(panelAuthVerdicts({ ...base, expose: 'tailscale', bindAddress: '100.64.0.2' }))
    expect(checks['web.auth']?.status).toBe('warn')
    expect(checks['web.auth']?.fix).toMatch(/panel\.auth required/)
  })

  it('warns the same way for a panel routed inside the VPN', () => {
    expect(byId(panelAuthVerdicts({ ...base, expose: 'vpn' }))['web.auth']?.status).toBe('warn')
  })

  // The office Wi-Fi is not an authenticated set, and nothing else in the
  // access mode says so — only the bind address does.
  it('fails a panel offered to the local network without the named opt-in', () => {
    const lan = { ...base, bindAddress: '192.168.1.10' }
    expect(byId(panelAuthVerdicts(lan))['web.auth']?.status).toBe('fail')
    expect(byId(panelAuthVerdicts({ ...lan, allowLan: true }))['web.auth']?.status).toBe('warn')
    expect(byId(panelAuthVerdicts({ ...lan, authMode: 'required', secretPresent: true }))['web.auth']?.status).toBe(
      'pass',
    )
  })

  it('fails a routed panel with nothing in front of it', () => {
    const checks = byId(panelAuthVerdicts({ ...base, expose: 'public' }))
    expect(checks['web.auth']?.status).toBe('fail')
    expect(checks['web.auth']?.fix).toMatch(/panel\.auth required/)
  })

  it('passes a routed panel that signs people in', () => {
    const checks = byId(panelAuthVerdicts({ ...base, expose: 'public', authMode: 'required', secretPresent: true }))
    expect(checks['web.auth']?.status).toBe('pass')
    expect(checks['web.auth.secret']?.status).toBe('pass')
  })

  // Without it the panel process refuses to boot, so this is a host that will
  // not come up rather than one that is quietly open.
  it('fails required mode with no secret to sign sessions with', () => {
    const checks = byId(panelAuthVerdicts({ ...base, authMode: 'required', secretPresent: false }))
    expect(checks['web.auth.secret']?.status).toBe('fail')
  })

  it('warns about a reachable panel that can still stop containers', () => {
    const routed = { ...base, expose: 'public', authMode: 'required', secretPresent: true }
    expect(byId(panelAuthVerdicts(routed))['web.readonly']?.status).toBe('warn')
    expect(byId(panelAuthVerdicts({ ...routed, readOnly: true }))['web.readonly']).toBeUndefined()
    // Not a finding on loopback: nothing outside the host can reach it.
    expect(byId(panelAuthVerdicts(base))['web.readonly']).toBeUndefined()
  })
})

// `portta bootstrap` ends by running doctor, on a host where nothing has been
// started yet. Treating "does not exist" as a failure made bootstrap exit 1 on
// every fresh host, and every CI job that boots the gateway died before `up`.
describe('an unstarted component is not a broken one', () => {
  const verdict = (present: boolean, state: string | null, health: string | null) =>
    componentVerdict('auth.service', 'authentication service', present, state, health, 'portta logs portta-auth')

  it('warns for a container that does not exist yet', () => {
    const answer = verdict(false, null, null)
    expect(answer.status).toBe('warn')
    expect(answer.detail).toBe('container not created')
  })

  it('fails for one that exists and is not running', () => {
    expect(verdict(true, 'created', null).status).toBe('fail')
    expect(verdict(true, 'exited', null).status).toBe('fail')
  })

  it('fails for one that is running and unhealthy', () => {
    expect(verdict(true, 'running', 'unhealthy').status).toBe('fail')
  })

  // Starting is neither: it is a state that resolves itself, and reporting it
  // as broken would make every `up` end in a failed doctor.
  it('warns while a health check is still starting', () => {
    expect(verdict(true, 'running', 'starting').status).toBe('warn')
  })

  it('passes for running and healthy, and for running with no health check', () => {
    expect(verdict(true, 'running', 'healthy').status).toBe('pass')
    expect(verdict(true, 'running', null).status).toBe('pass')
  })
})

describe('the authentication store', () => {
  it('is not created yet when nothing has ever run', () => {
    const answer = authStoreVerdict(false, null, false)
    expect(answer.status).toBe('warn')
    expect(answer.detail).toBe('not created yet')
  })

  it('is broken when the service is running without it', () => {
    expect(authStoreVerdict(false, null, true).status).toBe('fail')
  })

  // It holds every protected host's credential.
  it('must be owner-only', () => {
    expect(authStoreVerdict(true, '600', true).status).toBe('pass')
    expect(authStoreVerdict(true, '644', true).status).toBe('fail')
    expect(authStoreVerdict(true, null, true).status).toBe('fail')
  })
})
