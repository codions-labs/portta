// Who may open an address on a public host.
//
// The registry records a decision, and the labels on the container say whether
// anything enforces it. A route without the gate answers everybody, whatever the
// registry holds, so the two have to be read together wherever this is shown.

import type { Environment, ExposureView } from 'portta-contracts'
import { hasForwardAuth } from 'portta-core/browser'

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
  // Which router wins depends on rule length, so no address can be called safe.
  if (exposure && exposure.openRouters.count > 0) return 'unprotected'
  return exposure?.entries.find((entry) => canonicalHost(entry.host) === wanted)?.mode ?? 'closed'
}
