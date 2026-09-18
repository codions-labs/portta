import { type CheckDetail, check, type DoctorCheck } from './diagnostics.ts'
import type { HostKind } from './metrics.ts'

export type Observation = 'present' | 'absent' | 'unknown'

export interface SshdFacts {
  state: Observation
  reason: string | null
  source: 'effective' | 'file' | null
  port: string | null
  permitRootLogin: string | null
  passwordAuthentication: string | null
  pubkeyAuthentication: string | null
  usePam: string | null
}

export interface FirewallFacts {
  provider: 'ufw' | 'firewalld' | 'nftables' | 'pf'
  state: 'active' | 'inactive' | 'unknown'
  defaultInbound: string | null
  reason: string | null
}

export interface Fail2banFacts {
  state: Observation
  reason: string | null
  enabled: boolean | null
  active: boolean | null
  sshdJail: boolean | null
}

export interface HostSecurityFacts {
  sshd: SshdFacts
  firewalls: FirewallFacts[]
  fail2ban: Fail2banFacts
}

export interface HostSecurityContext {
  hostKind: HostKind | null
  platform: string
  profile: string
  publicAccess: boolean
}

export function permissionProblem(output: string): string | null {
  return /permission denied|operation not permitted|must be root|need to be root|requires root|not authorized/i.test(
    output,
  )
    ? 'could not be checked: this user does not have permission'
    : null
}

function directives(output: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z0-9]*)\s+(.*?)\s*$/.exec(line)
    if (match?.[1] && match[2]) values.set(match[1].toLowerCase(), match[2])
  }
  return values
}

export function parseSshdConfig(output: string, source: 'effective' | 'file' = 'effective'): SshdFacts {
  const values = directives(output)
  const known = ['port', 'permitrootlogin', 'passwordauthentication', 'pubkeyauthentication', 'usepam']
  if (!known.some((key) => values.has(key))) {
    return {
      state: 'unknown',
      reason: 'could not parse SSH server configuration',
      source: null,
      port: null,
      permitRootLogin: null,
      passwordAuthentication: null,
      pubkeyAuthentication: null,
      usePam: null,
    }
  }
  return {
    state: 'present',
    reason: null,
    source,
    port: values.get('port') ?? null,
    permitRootLogin: values.get('permitrootlogin') ?? null,
    passwordAuthentication: values.get('passwordauthentication') ?? null,
    pubkeyAuthentication: values.get('pubkeyauthentication') ?? null,
    usePam: values.get('usepam') ?? null,
  }
}

export function parseUfw(output: string): FirewallFacts {
  const status = /^Status:\s*(active|inactive)/im.exec(output)?.[1]?.toLowerCase()
  const inbound = /^Default:\s*([^,\n]+?)(?:\s*\(incoming\))?(?:,|$)/im.exec(output)?.[1]?.trim() ?? null
  return {
    provider: 'ufw',
    state: status === 'active' ? 'active' : status === 'inactive' ? 'inactive' : 'unknown',
    defaultInbound: inbound,
    reason: status ? null : 'could not parse UFW status',
  }
}

export function parseFirewalld(output: string): FirewallFacts {
  const value = output.trim().toLowerCase()
  const known = value === 'running' || value === 'active' || value === 'not running' || value === 'inactive'
  return {
    provider: 'firewalld',
    state:
      value === 'running' || value === 'active'
        ? 'active'
        : value === 'not running' || value === 'inactive'
          ? 'inactive'
          : 'unknown',
    defaultInbound: null,
    reason: known ? null : 'could not determine firewalld state',
  }
}

export function parseNftables(output: string): FirewallFacts {
  const policy = /hook\s+input[^;{]*;[^}]*policy\s+(drop|reject|accept)/is.exec(output)?.[1]?.toLowerCase() ?? null
  return {
    provider: 'nftables',
    state: output.trim() === '' ? 'inactive' : 'active',
    defaultInbound: policy,
    reason: null,
  }
}

export function parsePf(output: string): FirewallFacts {
  const enabled = /^Status:\s*Enabled/im.test(output)
  const disabled = /^Status:\s*Disabled/im.test(output)
  return {
    provider: 'pf',
    state: enabled ? 'active' : disabled ? 'inactive' : 'unknown',
    defaultInbound: null,
    reason: enabled || disabled ? null : 'could not parse pf status',
  }
}

export function parseFail2ban(enabled: string, active: string, jail: string): Fail2banFacts {
  const enabledValue = enabled.trim().toLowerCase()
  const activeValue = active.trim().toLowerCase()
  const jailLine = /^\s*`?-?\s*Jail list:\s*(.*)$/im.exec(jail)?.[1] ?? ''
  return {
    state: 'present',
    reason: null,
    enabled: enabledValue === 'enabled' ? true : enabledValue === 'disabled' ? false : null,
    active: activeValue === 'active' ? true : activeValue === 'inactive' || activeValue === 'failed' ? false : null,
    sshdJail:
      jailLine === ''
        ? null
        : jailLine
            .split(',')
            .map((value) => value.trim())
            .includes('sshd'),
  }
}

function finding(
  id: string,
  status: DoctorCheck['status'],
  title: string,
  detail: string,
  rationale: string,
  docs: string,
  fix = '',
  details?: CheckDetail[],
): DoctorCheck {
  return {
    ...check(id, status, title, detail, fix),
    category: 'security',
    rationale,
    docs,
    ...(details ? { details } : {}),
  }
}

export function securityVerdicts(facts: HostSecurityFacts, context: HostSecurityContext): DoctorCheck[] {
  const publicServer = context.publicAccess && context.hostKind !== 'notebook' && context.hostKind !== 'desktop'
  const checks: DoctorCheck[] = []

  if (facts.sshd.state === 'unknown') {
    checks.push(
      finding(
        'security.sshd',
        'info',
        'SSH server',
        facts.sshd.reason ?? 'could not be checked',
        'The effective SSH server policy may differ from one configuration file because includes and Match blocks apply.',
        'docs/product/guides/remote-bootstrap.md',
      ),
    )
  } else if (facts.sshd.state === 'absent') {
    checks.push(
      finding(
        'security.sshd',
        'info',
        'SSH server',
        'not observed on this host',
        'An absent server is normal on a workstation and may also mean SSH is provided outside this host.',
        'docs/product/guides/remote-bootstrap.md',
      ),
    )
  } else {
    const rootOpen = facts.sshd.permitRootLogin === 'yes'
    const passwordOpen = facts.sshd.passwordAuthentication === 'yes'
    const status = publicServer && (rootOpen || passwordOpen) ? 'warn' : rootOpen || passwordOpen ? 'info' : 'pass'
    const details: CheckDetail[] = [
      {
        status: publicServer && passwordOpen ? 'warn' : passwordOpen ? 'info' : 'pass',
        text: `PasswordAuthentication ${facts.sshd.passwordAuthentication ?? 'unknown'}`,
      },
      {
        status: publicServer && rootOpen ? 'warn' : rootOpen ? 'info' : 'pass',
        text: `PermitRootLogin ${facts.sshd.permitRootLogin ?? 'unknown'}`,
      },
      {
        status: facts.sshd.pubkeyAuthentication === 'yes' ? 'pass' : 'info',
        text: `PubkeyAuthentication ${facts.sshd.pubkeyAuthentication ?? 'unknown'}`,
      },
    ]
    checks.push(
      finding(
        'security.sshd',
        status,
        'SSH server',
        `${facts.sshd.source === 'file' ? 'file fallback' : 'effective configuration'}${facts.sshd.port ? ` on port ${facts.sshd.port}` : ''}`,
        publicServer
          ? 'Key-only authentication and a disabled direct root login reduce credential attacks on a publicly exposed server.'
          : 'These settings are contextual on a local workstation and are shown without treating it as compromised.',
        'docs/product/guides/remote-bootstrap.md',
        '',
        details,
      ),
    )
  }

  if (facts.firewalls.length === 0) {
    checks.push(
      finding(
        'security.firewall',
        publicServer ? 'warn' : 'info',
        'Host firewall',
        'no supported host firewall was observed',
        'Cloud firewalls and security groups are outside the host, so absence here is an observation rather than proof of exposure.',
        'docs/product/guides/firewall.md',
      ),
    )
  } else {
    const active = facts.firewalls.filter((entry) => entry.state === 'active')
    const unknown = facts.firewalls.filter((entry) => entry.state === 'unknown')
    const status = active.length > 0 ? 'pass' : unknown.length > 0 ? 'info' : publicServer ? 'warn' : 'info'
    const summary = facts.firewalls
      .map(
        (entry) => `${entry.provider}: ${entry.state}${entry.defaultInbound ? ` (input ${entry.defaultInbound})` : ''}`,
      )
      .join('; ')
    const ufw = facts.firewalls.some((entry) => entry.provider === 'ufw')
    checks.push(
      finding(
        'security.firewall',
        status,
        'Host firewall',
        summary,
        ufw
          ? "Docker's published ports traverse Docker's own rules and can bypass UFW; an active default-deny policy is not proof that published container ports are blocked."
          : 'A host firewall is one layer; Docker rules and cloud security groups remain separate boundaries.',
        'docs/product/guides/firewall.md',
      ),
    )
  }

  if (context.platform === 'darwin') {
    checks.push(
      finding(
        'security.fail2ban',
        'info',
        'Fail2ban',
        'not applicable on the verified macOS host profile',
        'Fail2ban is evaluated only on Linux hosts where systemd and the SSH jail are meaningful.',
        'docs/product/concepts/security.md',
      ),
    )
  } else if (facts.fail2ban.state === 'unknown') {
    checks.push(
      finding(
        'security.fail2ban',
        'info',
        'Fail2ban',
        facts.fail2ban.reason ?? 'could not be checked',
        'A permission failure is not treated as an absent service.',
        'docs/product/concepts/security.md',
      ),
    )
  } else if (facts.fail2ban.state === 'absent') {
    checks.push(
      finding(
        'security.fail2ban',
        'info',
        'Fail2ban',
        'not installed',
        publicServer
          ? 'Rate-limiting repeated SSH authentication failures is recommended on publicly exposed servers.'
          : 'This is optional on an isolated local machine.',
        'docs/product/concepts/security.md',
      ),
    )
  } else {
    const healthy = facts.fail2ban.active === true && facts.fail2ban.sshdJail === true
    checks.push(
      finding(
        'security.fail2ban',
        healthy ? 'pass' : publicServer ? 'warn' : 'info',
        'Fail2ban',
        `unit ${facts.fail2ban.active ? 'active' : 'inactive or unknown'}; sshd jail ${facts.fail2ban.sshdJail ? 'present' : 'absent or unknown'}`,
        'The sshd jail limits repeated authentication attempts without changing the SSH server policy.',
        'docs/product/concepts/security.md',
      ),
    )
  }

  return checks
}
