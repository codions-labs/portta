// Compose dependency order for a project-wide start or stop.
//
// `com.docker.compose.depends_on` is present only when the project declared
// it. Without it, the order is the service name, which is arbitrary and
// stable. A cycle falls back to name order for the members of the cycle.

export const COMPOSE_DEPENDS_ON = 'com.docker.compose.depends_on'

export interface OrderableService {
  service: string
  name: string
  dependsOn: string[]
}

/** `db:service_started:false,redis:service_healthy:false`, a JSON map, or a list. */
export function parseDependsOn(label: string | undefined | null): string[] {
  if (!label || label.trim() === '') return []
  const trimmed = label.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
      if (parsed && typeof parsed === 'object') return Object.keys(parsed)
    } catch {
      /* fall through to the Compose label form */
    }
  }
  return [
    ...new Set(
      trimmed
        .split(',')
        .map((part) => part.trim().split(':')[0] ?? '')
        .filter(Boolean),
    ),
  ]
}

function byName<T extends OrderableService>(left: T, right: T): number {
  return (left.service || left.name).localeCompare(right.service || right.name)
}

/**
 * `stop`: services nothing else depends on first (the API before Postgres).
 * `start`: services that depend on nothing first (Postgres before the API).
 */
export function orderProjectServices<T extends OrderableService>(services: T[], direction: 'start' | 'stop'): T[] {
  const byService = new Map<string, T>()
  for (const entry of services) byService.set(entry.service || entry.name, entry)

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const entry of services) {
    const key = entry.service || entry.name
    incoming.set(key, incoming.get(key) ?? 0)
    outgoing.set(key, outgoing.get(key) ?? [])
  }

  for (const entry of services) {
    const key = entry.service || entry.name
    for (const dependency of entry.dependsOn) {
      if (!byService.has(dependency)) continue
      if (direction === 'start') {
        // Edge dependency → dependent: start the dependency first.
        outgoing.get(dependency)!.push(key)
        incoming.set(key, (incoming.get(key) ?? 0) + 1)
      } else {
        // Edge dependent → dependency: stop the dependent first.
        outgoing.get(key)!.push(dependency)
        incoming.set(dependency, (incoming.get(dependency) ?? 0) + 1)
      }
    }
  }

  const ready = [...services].filter((entry) => (incoming.get(entry.service || entry.name) ?? 0) === 0).sort(byName)
  const ordered: T[] = []
  const seen = new Set<string>()

  while (ready.length > 0) {
    const next = ready.shift()!
    const key = next.service || next.name
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push(next)
    for (const successor of outgoing.get(key) ?? []) {
      const remaining = (incoming.get(successor) ?? 0) - 1
      incoming.set(successor, remaining)
      if (remaining === 0) {
        const node = byService.get(successor)
        if (node) ready.push(node)
        ready.sort(byName)
      }
    }
  }

  const leftover = services.filter((entry) => !seen.has(entry.service || entry.name)).sort(byName)
  return [...ordered, ...leftover]
}
