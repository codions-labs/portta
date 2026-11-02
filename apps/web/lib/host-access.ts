// Who may open an address on a public host.
//
// The registry records a decision, and the labels on the container say whether
// anything enforces it. A route without the gate answers everybody, whatever the
// registry holds, so the two have to be read together wherever this is shown.

import type { Environment, ExposureView } from 'portta-contracts'
import { hasForwardAuth, opensUnknownHosts } from 'portta-core/browser'

export type HostMode = 'protected' | 'public' | 'closed' | 'unprotected'

/** The same canonical form the server keys its registry by: lowercase, punycode, no trailing dot or default port. */
export function canonicalHost(host: string): string {
  try {
    const parsed = new URL(`http://${host.trim()}`)
    return `${parsed.hostname.replace(/\.$/, '')}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return host.trim().toLowerCase()
  }
}

/**
 * Containers that answer with no login on names nobody can list. Portta's own are
 * left out: the panel's public entrypoint is a bare PathPrefix on a port of its own.
 */
export function unknownOpenRouters(environment: Pick<Environment, 'services'>): string[] {
  return environment.services
    .filter((candidate) => candidate.labels['portta.managed'] !== 'true' && opensUnknownHosts(candidate.labels))
    .map((candidate) => candidate.name)
}

export function hostAccess(
  environment: Pick<Environment, 'services'>,
  host: string,
  exposure: ExposureView | undefined,
): HostMode {
  const wanted = canonicalHost(host)
  // Replicas answer on the same name, and one without the gate opens all of it.
  const claimants = environment.services.filter((candidate) =>
    candidate.urls.some((url) => canonicalHost(url.host) === wanted),
  )
  if (claimants.some((candidate) => !hasForwardAuth(candidate.labels))) return 'unprotected'
  // Which router wins depends on rule length, so this address cannot be called safe.
  if (unknownOpenRouters(environment).length > 0) return 'unprotected'
  return exposure?.entries.find((entry) => canonicalHost(entry.host) === wanted)?.mode ?? 'closed'
}
