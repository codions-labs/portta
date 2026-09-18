import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProbeContext } from '../types.ts'
import { collectHostSecurityChecks, hostSecurityContext } from './index.ts'
import { probeFail2ban, probeFirewalls, probeSshd, SECURITY_COMMAND_ALLOWLIST } from './probes.ts'

function result(stdout = '', failed = false, stderr = '') {
  return { stdout, stderr, failed, exitCode: failed ? 1 : 0 }
}

function context(
  paths: Record<string, string | null>,
  responses: Record<string, ReturnType<typeof result>>,
): ProbeContext {
  return {
    locate: vi.fn(async (tool) => paths[tool] ?? null),
    run: vi.fn(async (file, args = []) => responses[`${file} ${args.join(' ')}`] ?? result('', true)),
    fileMode: vi.fn(() => null),
    homeDir: '/does-not-exist',
    environment: {},
  }
}

describe('read-only host security probes', () => {
  it('uses the persisted gateway profile and honours an explicit override', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-security-context-'))
    writeFileSync(join(root, '.env'), 'PORTTA_PROFILE=remote-public\n')
    vi.stubEnv('PORTTA_PROFILE', 'local')
    try {
      expect(hostSecurityContext(root)).toMatchObject({ profile: 'remote-public', publicAccess: true })
      expect(hostSecurityContext(root, 'local')).toMatchObject({ profile: 'local', publicAccess: false })
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('has a literal command allowlist with no escalation or mutating verbs', () => {
    const commands = SECURITY_COMMAND_ALLOWLIST.map((parts) => parts.join(' ')).join('\n')
    expect(commands).not.toMatch(/\bsudo\b|\benable\b|\bdisable\b|\bstart\b|\bstop\b|\breload\b|\badd\b|\bdelete\b/)
    expect(SECURITY_COMMAND_ALLOWLIST).toHaveLength(8)
  })

  it('reports permission denial as unknown rather than absent', async () => {
    const probe = context(
      { sshd: '/usr/sbin/sshd' },
      {
        '/usr/sbin/sshd -T': result('', true, 'sshd: no hostkeys available -- exiting. permission denied'),
      },
    )
    expect(await probeSshd(probe)).toMatchObject({ state: 'unknown', reason: expect.stringContaining('permission') })
  })

  it('observes every installed firewall and keeps a denied one unknown', async () => {
    const probe = context(
      { ufw: '/usr/sbin/ufw', nft: '/usr/sbin/nft', 'firewall-cmd': null, pfctl: null },
      {
        '/usr/sbin/ufw status verbose': result('Status: active\nDefault: deny (incoming), allow (outgoing)'),
        '/usr/sbin/nft list ruleset': result('', true, 'Operation not permitted'),
      },
    )
    const facts = await probeFirewalls(probe, 'linux')
    expect(facts).toEqual([
      expect.objectContaining({ provider: 'ufw', state: 'active', defaultInbound: 'deny' }),
      expect.objectContaining({
        provider: 'nftables',
        state: 'unknown',
        reason: expect.stringContaining('permission'),
      }),
    ])
  })

  it('reads Fail2ban state without retaining banned addresses', async () => {
    const probe = context(
      { 'fail2ban-client': '/bin/fail2ban-client', systemctl: '/bin/systemctl' },
      {
        '/bin/systemctl is-enabled fail2ban': result('enabled\n'),
        '/bin/systemctl is-active fail2ban': result('active\n'),
        '/bin/fail2ban-client status sshd': result('Jail list: sshd\nBanned IP list: 203.0.113.9'),
      },
    )
    const facts = await probeFail2ban(probe, 'linux')
    expect(facts).toMatchObject({ state: 'present', enabled: true, active: true, sshdJail: true })
    expect(JSON.stringify(facts)).not.toContain('203.0.113.9')
  })

  it('makes Fail2ban explicitly not applicable on macOS without probing', async () => {
    const probe = context({}, {})
    expect(await probeFail2ban(probe, 'darwin')).toMatchObject({ state: 'absent', reason: 'not applicable' })
    expect(probe.run).not.toHaveBeenCalled()
  })

  it('reports the owner-only mode of Portta SSH storage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-security-'))
    const directory = join(root, 'state/ssh')
    mkdirSync(directory, { recursive: true, mode: 0o755 })
    chmodSync(directory, 0o755)
    const probe = context({}, {})
    probe.fileMode = vi.fn(() => '755')
    try {
      const checks = await collectHostSecurityChecks(root, probe, {
        hostKind: 'server',
        platform: 'linux',
        profile: 'remote-public',
        publicAccess: true,
      })
      expect(checks.find((check) => check.id === 'security.portta-ssh-storage')).toMatchObject({
        status: 'warn',
        detail: 'state/ssh mode: 755',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
