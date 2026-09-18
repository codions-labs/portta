import type { EnvironmentRecord } from 'portta-core/taskflow'
import type { EnvironmentProvider } from '../adapters/environment-provider.ts'

export function environmentTrustPatch(
  record: EnvironmentRecord,
): Pick<EnvironmentRecord, 'security' | 'status' | 'desiredStatus'> {
  return {
    security: { ...record.security, trusted: true },
    status: 'detected',
    desiredStatus: record.desiredStatus,
  }
}

export async function reconcileEnvironment(
  record: EnvironmentRecord,
  provider: EnvironmentProvider,
  now: string,
  beforeStop: () => Promise<void> = async () => {},
): Promise<EnvironmentRecord> {
  if (
    record.status === 'awaiting_trust' ||
    record.status === 'detected' ||
    record.status === 'resolving' ||
    record.status === 'building' ||
    record.status === 'starting' ||
    (record.status === 'stopping' && record.desiredStatus !== 'destroyed') ||
    (record.status === 'failed' && record.desiredStatus !== 'ready')
  )
    return record
  try {
    const observed = await provider.inspect(record)
    if (observed.status === 'missing') {
      return {
        ...record,
        status: 'missing',
        error: observed.diagnostics.join('; ') || 'Environment resources are missing',
        updatedAt: now,
      }
    }
    if (record.desiredStatus === 'destroyed') {
      await beforeStop()
      await provider.destroy(record)
      return { ...record, status: 'missing', error: null, updatedAt: now }
    }
    if (record.desiredStatus === 'stopped' && observed.status === 'ready') {
      await beforeStop()
      await provider.stop(record)
      return { ...record, status: 'stopped', error: null, updatedAt: now }
    }
    if (record.desiredStatus === 'ready' && observed.status === 'stopped') {
      const resumed = await provider.resume(record)
      return { ...record, ...resumed, status: 'ready', error: null, updatedAt: now }
    }
    return {
      ...record,
      status: observed.status,
      error: observed.diagnostics.length > 0 ? observed.diagnostics.join('; ') : null,
      updatedAt: now,
    }
  } catch (error: unknown) {
    return {
      ...record,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: now,
    }
  }
}
