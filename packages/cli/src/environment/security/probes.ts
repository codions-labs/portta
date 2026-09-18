import { existsSync, readFileSync } from 'node:fs'
import {
  type Fail2banFacts,
  type FirewallFacts,
  parseFail2ban,
  parseFirewalld,
  parseNftables,
  parsePf,
  parseSshdConfig,
  parseUfw,
  permissionProblem,
  type SshdFacts,
} from 'portta-core'
import { PROBE_TIMEOUT_MS } from '../common.js'
import type { ProbeContext } from '../types.js'

export const SECURITY_COMMAND_ALLOWLIST = [
  ['sshd', '-T'],
  ['ufw', 'status', 'verbose'],
  ['firewall-cmd', '--state'],
  ['nft', 'list', 'ruleset'],
  ['pfctl', '-s', 'info'],
  ['systemctl', 'is-enabled', 'fail2ban'],
  ['systemctl', 'is-active', 'fail2ban'],
  ['fail2ban-client', 'status', 'sshd'],
] as const

function emptySshd(state: SshdFacts['state'], reason: string | null): SshdFacts {
  return {
    state,
    reason,
    source: null,
    port: null,
    permitRootLogin: null,
    passwordAuthentication: null,
    pubkeyAuthentication: null,
    usePam: null,
  }
}

export async function probeSshd(context: ProbeContext): Promise<SshdFacts> {
  const executable = await context.locate('sshd')
  let commandFailure: string | null = null
  if (executable) {
    const result = await context.run(executable, ['-T'], { reject: false, timeout: PROBE_TIMEOUT_MS })
    if (!result.failed) return parseSshdConfig(result.stdout, 'effective')
    const denied = permissionProblem(`${result.stderr}\n${result.stdout}`)
    if (denied) return emptySshd('unknown', denied)
    commandFailure = 'the effective SSH configuration command failed'
  }
  for (const path of ['/etc/ssh/sshd_config', '/private/etc/ssh/sshd_config']) {
    if (!existsSync(path)) continue
    try {
      const parsed = parseSshdConfig(readFileSync(path, 'utf8'), 'file')
      return parsed.state === 'present'
        ? parsed
        : emptySshd('unknown', 'the SSH configuration file could not be interpreted')
    } catch {
      return emptySshd('unknown', 'could not be checked: this user cannot read the SSH configuration')
    }
  }
  return commandFailure ? emptySshd('unknown', commandFailure) : emptySshd('absent', null)
}

export async function probeFirewalls(context: ProbeContext, platform: string): Promise<FirewallFacts[]> {
  const definitions = (
    [
      ['ufw', ['status', 'verbose'], parseUfw],
      ['firewall-cmd', ['--state'], parseFirewalld],
      ['nft', ['list', 'ruleset'], parseNftables],
      ['pfctl', ['-s', 'info'], parsePf],
    ] as const
  ).filter(([command]) => (platform === 'darwin' ? command === 'pfctl' : command !== 'pfctl'))
  const observed = await Promise.all(
    definitions.map(async ([command, args, parse]) => {
      const executable = await context.locate(command)
      if (!executable) return null
      const result = await context.run(executable, args, { reject: false, timeout: PROBE_TIMEOUT_MS })
      if (!result.failed) return parse(result.stdout || result.stderr)
      return {
        provider:
          command === 'firewall-cmd'
            ? 'firewalld'
            : command === 'nft'
              ? 'nftables'
              : command === 'pfctl'
                ? 'pf'
                : command,
        state: 'unknown',
        defaultInbound: null,
        reason: permissionProblem(`${result.stderr}\n${result.stdout}`) ?? 'the firewall command could not be checked',
      } satisfies FirewallFacts
    }),
  )
  return observed.filter((entry): entry is FirewallFacts => entry !== null)
}

export async function probeFail2ban(context: ProbeContext, platform: string): Promise<Fail2banFacts> {
  if (platform === 'darwin')
    return { state: 'absent', reason: 'not applicable', enabled: null, active: null, sshdJail: null }
  const client = await context.locate('fail2ban-client')
  if (!client) return { state: 'absent', reason: null, enabled: null, active: null, sshdJail: null }
  const systemctl = await context.locate('systemctl')
  const [enabled, active, jail] = await Promise.all([
    systemctl
      ? context.run(systemctl, ['is-enabled', 'fail2ban'], { reject: false, timeout: PROBE_TIMEOUT_MS })
      : Promise.resolve(null),
    systemctl
      ? context.run(systemctl, ['is-active', 'fail2ban'], { reject: false, timeout: PROBE_TIMEOUT_MS })
      : Promise.resolve(null),
    context.run(client, ['status', 'sshd'], { reject: false, timeout: PROBE_TIMEOUT_MS }),
  ])
  const denied = permissionProblem(`${enabled?.stderr ?? ''}\n${active?.stderr ?? ''}\n${jail.stderr}`)
  if (denied) return { state: 'unknown', reason: denied, enabled: null, active: null, sshdJail: null }
  const parsed = parseFail2ban(enabled?.stdout ?? '', active?.stdout ?? '', jail.failed ? 'Jail list: ' : jail.stdout)
  return { ...parsed, sshdJail: jail.failed ? false : parsed.sshdJail }
}
