// One answer to "is this environment fine", used by every row that shows one.

export type EnvironmentHealth = 'ok' | 'partial' | 'down' | 'unhealthy'

/**
 * A service that exited 0 with no restart policy (a migration, an init job)
 * completed: it counts as fine, not as down. An environment where nothing runs
 * is still down, even when everything in it completed. The server applies the
 * same rule when it decides what deserves attention.
 */
export function environmentHealth(counts: {
  serviceCount: number
  runningCount: number
  unhealthyCount: number
  completedCount?: number
}): EnvironmentHealth {
  if (counts.unhealthyCount > 0) return 'unhealthy'
  if (counts.serviceCount === 0 || counts.runningCount === 0) return 'down'
  if (counts.runningCount + (counts.completedCount ?? 0) < counts.serviceCount) return 'partial'
  return 'ok'
}

export function healthTone(health: EnvironmentHealth): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (health) {
    case 'ok':
      return 'ok'
    case 'partial':
      return 'warn'
    case 'unhealthy':
      return 'danger'
    default:
      return 'neutral'
  }
}
