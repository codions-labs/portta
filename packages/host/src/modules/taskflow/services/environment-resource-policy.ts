import { createHash } from 'node:crypto'
import type { EnvironmentHandle, EnvironmentRecord, EnvironmentRuntimeOverride } from 'portta-core/taskflow'
import type { ProcessRunner } from '../adapters/process-runner.ts'
import { runCaptured } from '../adapters/process-runner.ts'

const policy = {
  cpus: 4,
  memory: '8g',
  memoryBytes: 8 * 1024 * 1024 * 1024,
  memorySwap: '8g',
  pids: 1024,
} as const

export function hasEnvironmentCapacity(records: EnvironmentRecord[], environmentId: string, limit: number): boolean {
  return (
    records.filter(
      (record) =>
        record.id !== environmentId &&
        record.provider !== 'host' &&
        record.desiredStatus === 'ready' &&
        record.status !== 'missing' &&
        record.status !== 'failed',
    ).length < limit
  )
}

async function containerIds(runner: ProcessRunner, handle: EnvironmentHandle): Promise<string[]> {
  const composeProject = handle.providerRef.value.composeProjectName
  if (typeof composeProject === 'string' && composeProject) {
    const result = await runCaptured(runner, {
      command: 'docker',
      args: ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${composeProject}`],
    })
    if (result.exit.code !== 0) throw new Error(`Unable to enumerate environment containers: ${result.stderr.trim()}`)
    return result.stdout.split(/\s+/).filter(Boolean)
  }
  const id = handle.providerRef.value.containerId ?? handle.providerRef.value.containerName
  return typeof id === 'string' && id ? [id] : []
}

export async function applyEnvironmentResourcePolicy(
  runner: ProcessRunner,
  handle: EnvironmentHandle,
): Promise<EnvironmentHandle> {
  if (handle.provider === 'host') return handle
  const ids = await containerIds(runner, handle)
  if (ids.length === 0) throw new Error(`Environment has no owned containers for resource policy: ${handle.id}`)
  const diff = [
    `cpus=${policy.cpus}`,
    `memory=${policy.memory}`,
    `memory-swap=${policy.memorySwap}`,
    `pids=${policy.pids}`,
  ]
  const updated = await runCaptured(runner, {
    command: 'docker',
    args: [
      'update',
      '--cpus',
      String(policy.cpus),
      '--memory',
      policy.memory,
      '--memory-swap',
      policy.memorySwap,
      '--pids-limit',
      String(policy.pids),
      ...ids,
    ],
  })
  if (updated.exit.code !== 0) throw new Error(`Unable to apply environment resource policy: ${updated.stderr.trim()}`)
  for (const id of ids) {
    const inspected = await runCaptured(runner, {
      command: 'docker',
      args: [
        'inspect',
        '--format',
        '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}}',
        id,
      ],
    })
    if (inspected.exit.code !== 0)
      throw new Error(`Unable to validate environment resource policy: ${inspected.stderr.trim()}`)
    const [nanoCpus, memory, memorySwap, pids] = inspected.stdout.trim().split(/\s+/).map(Number)
    if (
      nanoCpus !== policy.cpus * 1_000_000_000 ||
      memory !== policy.memoryBytes ||
      memorySwap !== policy.memoryBytes ||
      pids !== policy.pids
    ) {
      throw new Error(`Container resource policy validation failed: ${id}`)
    }
  }
  const evidence: EnvironmentRuntimeOverride = {
    path: 'docker:update',
    hash: createHash('sha256').update(diff.join('\0')).digest('hex'),
    diff,
    effective: {
      containerIds: ids,
      cpus: policy.cpus,
      memory: policy.memory,
      memorySwap: policy.memorySwap,
      pids: policy.pids,
    },
    validated: true,
    diagnostics: ['Storage quota is unavailable for the active Docker storage driver'],
  }
  return {
    ...handle,
    runtimeOverride: evidence,
    providerRef: {
      ...handle.providerRef,
      value: { ...handle.providerRef.value, runtimeOverride: evidence },
    },
  }
}
