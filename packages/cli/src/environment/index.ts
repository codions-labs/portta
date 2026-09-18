import { homedir } from 'node:os'
import { type DoctorCheck, type EnvironmentReport, summariseEnvironment } from 'portta-core'
import { fileMode, locate } from '../host.js'
import { runProcess } from '../process.js'
import { agentsProbe } from './agents.js'
import { developmentProbe } from './development.js'
import { dockerProbe } from './docker.js'
import { sshProbe, tmuxProbe } from './ssh.js'
import type { EnvironmentProbe, ProbeContext } from './types.js'

export const ENVIRONMENT_PROBES: readonly EnvironmentProbe[] = [
  dockerProbe,
  developmentProbe,
  sshProbe,
  tmuxProbe,
  agentsProbe,
]

export function defaultProbeContext(): ProbeContext {
  return { locate, run: runProcess, fileMode, homeDir: homedir(), environment: process.env }
}

export async function collectEnvironmentChecks(context = defaultProbeContext()): Promise<DoctorCheck[]> {
  const nested = await Promise.all(ENVIRONMENT_PROBES.map((probe) => probe.probe(context)))
  return nested.flat()
}

export async function collectEnvironmentReport(
  context = defaultProbeContext(),
  now = Date.now(),
): Promise<EnvironmentReport> {
  const checks = await collectEnvironmentChecks(context)
  return {
    version: 1,
    collectedAt: Math.floor(now / 1000),
    durationMs: Math.max(0, Date.now() - now),
    checks,
    summary: summariseEnvironment(checks),
  }
}

export type { EnvironmentProbe, ProbeContext } from './types.js'
