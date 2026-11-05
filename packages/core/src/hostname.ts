import { nameIdentity, shortHash } from './name-digest.ts'
import { slug } from './namespace.ts'

/** One label keeps every generated endpoint inside the same wildcard certificate. */
export const MAX_LABEL = 63
export const MAX_HOSTNAME = 253
export const COMPONENT_SEPARATOR = '--'
export const HOSTNAME_LABEL = 'portta.hostname'
export const HOSTNAME_CONTEXT_LABEL = 'portta.context'

export { shortHash }

export interface HostLabelParts {
  /** The Compose namespace is opaque; it may already include a branch. */
  project: string
  service: string
  /** An independent context, never a branch repeated from the namespace. */
  context?: string | null
}

function component(value: string, field: string): string {
  nameIdentity([value])
  const normalized = slug(value)
  if (!normalized) throw new Error(`${field} has no hostname characters`)
  return normalized
}

/** R-LDH labels reserve hyphens in positions three and four for IDNA. */
function avoidReservedLabel(label: string): string {
  return label.slice(2, 4) === '--' ? `env-${label}` : label
}

/** Validate a precomputed label instead of trusting arbitrary Docker metadata. */
export function validateHostLabel(label: string): string {
  if (label.length > MAX_LABEL || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label) || label.slice(2, 4) === '--') {
    throw new Error(`invalid hostname label: ${label}`)
  }
  return label
}

/** Fit the readable label while hashing its complete original identity. */
export function fitLabel(label: string, limit = MAX_LABEL, identity = label): string {
  if (!Number.isSafeInteger(limit) || limit < 10 || limit > MAX_LABEL) throw new Error('invalid hostname label limit')
  if (label.length <= limit) return label
  return `${label.slice(0, limit - 9).replace(/-+$/, '')}-${shortHash(identity)}`
}

function readableParts(parts: HostLabelParts): { label: string; identity: string } {
  const identity = nameIdentity([parts.project, parts.service, parts.context ?? ''])
  const fields = [component(parts.project, 'project'), component(parts.service, 'service')]
  if (parts.context) fields.push(component(parts.context, 'context'))
  return { label: avoidReservedLabel(fields.join(COMPONENT_SEPARATOR)), identity }
}

/** `<namespace>--<service>[--<context>]`, normalized and bounded exactly once. */
export function hostLabel(parts: HostLabelParts): string {
  const { label, identity } = readableParts(parts)
  return validateHostLabel(fitLabel(label, MAX_LABEL, identity))
}

/** Preserve the share identifier even when the namespace must be abbreviated. */
export function shareLabel(parts: HostLabelParts & { id: string }): string {
  const { label } = readableParts(parts)
  const suffix = `--share-${component(parts.id, 'share id')}`
  const identity = nameIdentity([parts.project, parts.service, parts.context ?? '', parts.id])
  return validateHostLabel(`${fitLabel(label, MAX_LABEL - suffix.length, identity)}${suffix}`)
}

/** The same decision as Traefik's defaultRule, including standalone containers. */
export function hostLabelFromLabels(labels: Record<string, string>, containerName: string): string {
  const assigned = labels[HOSTNAME_LABEL]
  if (assigned) return validateHostLabel(assigned)
  const project = labels['com.docker.compose.project']
  if (project) {
    return hostLabel({
      project,
      service: labels['com.docker.compose.service'] ?? '',
      context: labels[HOSTNAME_CONTEXT_LABEL] ?? null,
    })
  }
  const identity = nameIdentity([containerName])
  return validateHostLabel(fitLabel(avoidReservedLabel(component(containerName, 'container')), MAX_LABEL, identity))
}

/** Validate the complete DNS name as well as its generated first label. */
export function hostnameFor(parts: HostLabelParts, domain: string): string {
  return hostnameFromLabel(hostLabel(parts), domain)
}

export function hostnameFromLabel(label: string, domain: string): string {
  validateHostLabel(label)
  const base = domain.toLowerCase().replace(/\.$/, '')
  if (
    !base ||
    base.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part) || part.length > MAX_LABEL)
  ) {
    throw new Error(`invalid hostname domain: ${domain}`)
  }
  const host = `${label}.${base}`
  if (host.length > MAX_HOSTNAME) throw new Error('hostname exceeds 253 octets')
  return host
}
