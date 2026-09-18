import { describe, expect, it } from 'vitest'
import {
  type HostSecurityFacts,
  parseFail2ban,
  parseFirewalld,
  parseNftables,
  parsePf,
  parseSshdConfig,
  parseUfw,
  permissionProblem,
  securityVerdicts,
} from './host-security.ts'

const SSHD = `port 22
permitrootlogin yes
passwordauthentication yes
pubkeyauthentication yes
usepam yes
hostkey /etc/ssh/ssh_host_ed25519_key
`

const FACTS: HostSecurityFacts = {
  sshd: parseSshdConfig(SSHD),
  firewalls: [parseUfw('Status: inactive\nDefault: deny (incoming), allow (outgoing), disabled (routed)')],
  fail2ban: { state: 'absent', reason: null, enabled: null, active: null, sshdJail: null },
}

describe('host security parsers', () => {
  it('extracts only named SSH directives and discards host key paths', () => {
    const parsed = parseSshdConfig(SSHD)
    expect(parsed).toMatchObject({
      state: 'present',
      port: '22',
      permitRootLogin: 'yes',
      passwordAuthentication: 'yes',
      pubkeyAuthentication: 'yes',
    })
    expect(JSON.stringify(parsed)).not.toContain('ssh_host_ed25519_key')
  })

  it('refuses to guess from unparseable SSH output', () => {
    expect(parseSshdConfig('OpenSSH server')).toMatchObject({
      state: 'unknown',
      reason: expect.stringContaining('could not parse'),
    })
  })

  it('parses active and inactive firewall fixtures across supported families', () => {
    expect(parseUfw('Status: active\nDefault: deny (incoming), allow (outgoing)').state).toBe('active')
    expect(parseUfw('Status: inactive').state).toBe('inactive')
    expect(parseFirewalld('running').state).toBe('active')
    expect(parseFirewalld('not running').state).toBe('inactive')
    expect(
      parseNftables('table inet filter { chain input { type filter hook input priority 0; policy drop; } }'),
    ).toMatchObject({ state: 'active', defaultInbound: 'drop' })
    expect(parsePf('Status: Enabled for 0 days')).toMatchObject({ state: 'active' })
    expect(parsePf('not pf output').state).toBe('unknown')
  })

  it('distinguishes permission denial from absence', () => {
    expect(permissionProblem('ufw: You need to be root to run this script')).toMatch(/does not have permission/)
    expect(permissionProblem('command not found')).toBeNull()
  })

  it('extracts service state and only the presence of the sshd jail', () => {
    const parsed = parseFail2ban('enabled\n', 'active\n', 'Jail list: nginx, sshd\nBanned IP list: 203.0.113.8')
    expect(parsed).toMatchObject({ enabled: true, active: true, sshdJail: true })
    expect(JSON.stringify(parsed)).not.toContain('203.0.113.8')
  })
})

describe('context-graded host security', () => {
  it('warns for password and root login on a public server but stays neutral locally', () => {
    const publicChecks = securityVerdicts(FACTS, {
      hostKind: 'server',
      platform: 'linux',
      profile: 'remote-public',
      publicAccess: true,
    })
    const localChecks = securityVerdicts(FACTS, {
      hostKind: 'notebook',
      platform: 'darwin',
      profile: 'local',
      publicAccess: false,
    })
    expect(publicChecks.find((entry) => entry.id === 'security.sshd')?.status).toBe('warn')
    expect(localChecks.find((entry) => entry.id === 'security.sshd')?.status).toBe('info')
    expect(publicChecks.find((entry) => entry.id === 'security.firewall')?.status).toBe('warn')
    expect(localChecks.find((entry) => entry.id === 'security.firewall')?.status).toBe('info')
  })
})
