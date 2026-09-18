import { existsSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import {
  check,
  type DoctorCheck,
  type EnvironmentReport,
  type HostSecurityContext,
  type HostSecurityFacts,
  isTrue,
  mergeEnvironment,
  parseEnv,
  securityVerdicts,
  summariseEnvironment,
} from 'portta-core'
import { readCurrent } from '../../metrics/store.js'
import { defaultProbeContext } from '../index.js'
import type { ProbeContext } from '../types.js'
import { probeFail2ban, probeFirewalls, probeSshd } from './probes.js'

export type HostSecurityReport = EnvironmentReport

export function hostSecurityContext(root: string, profileOverride?: string): HostSecurityContext {
  const snapshot = readCurrent(root)
  const file = existsSync(join(root, '.env'))
    ? parseEnv(readFileSync(join(root, '.env'), 'utf8'))
    : new Map<string, string>()
  const environment = mergeEnvironment(file, process.env)
  const profile = profileOverride ?? environment.PORTTA_PROFILE ?? 'local'
  return {
    hostKind: snapshot?.host.kind ?? null,
    platform: snapshot?.host.platform ?? platform(),
    profile,
    publicAccess: profile === 'remote-public' || isTrue(environment.PUBLIC_ENABLED),
  }
}

export async function collectHostSecurityFacts(
  context: ProbeContext,
  securityContext: HostSecurityContext,
): Promise<HostSecurityFacts> {
  const [sshd, firewalls, fail2ban] = await Promise.all([
    probeSshd(context),
    probeFirewalls(context, securityContext.platform),
    probeFail2ban(context, securityContext.platform),
  ])
  return { sshd, firewalls, fail2ban }
}

export async function collectHostSecurityChecks(
  root: string,
  probeContext = defaultProbeContext(),
  securityContext = hostSecurityContext(root),
): Promise<DoctorCheck[]> {
  const checks = securityVerdicts(await collectHostSecurityFacts(probeContext, securityContext), securityContext)
  const sshDirectory = join(root, 'state/ssh')
  const mode = probeContext.fileMode(sshDirectory)
  checks.push({
    ...check(
      'security.portta-ssh-storage',
      !existsSync(sshDirectory) ? 'info' : mode === '700' ? 'pass' : 'warn',
      'Portta SSH storage',
      !existsSync(sshDirectory) ? 'not created yet' : `state/ssh mode: ${mode ?? 'could not determine'}`,
      mode && mode !== '700' ? `chmod 700 ${sshDirectory}` : '',
    ),
    category: 'security',
    rationale:
      'Portta-owned private SSH keys share this directory; only the installation owner should be able to traverse it.',
    docs: 'docs/product/guides/ssh-keys.md',
  })
  return checks
}

export async function collectHostSecurityReport(
  root: string,
  probeContext = defaultProbeContext(),
  securityContext = hostSecurityContext(root),
  now = Date.now(),
): Promise<HostSecurityReport> {
  const checks = await collectHostSecurityChecks(root, probeContext, securityContext)
  return {
    version: 1,
    collectedAt: Math.floor(now / 1000),
    durationMs: Math.max(0, Date.now() - now),
    checks,
    summary: summariseEnvironment(checks),
  }
}
