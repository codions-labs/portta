import { slug } from './namespace.ts'

/**
 * What a service is called, in one DNS label: `<project>-<service>`, the
 * name Traefik's `defaultRule` produces and the panel re-derives for display
 * ([ADR 0005](../../../docs/development/adr/0005-hostname-convention.md)).
 * A context — a branch, a pull request, a preview — is appended with `--`:
 * `slug` collapses runs of `-`, so no component can ever contain `--`, which
 * keeps the separator unambiguous.
 *
 *     storefront-web.example.com
 *     storefront-web--pr-42.example.com
 *
 * ### Why one label and not `web.storefront.example.com`
 *
 * Measured, not assumed. Cloudflare's Universal SSL covers the apex and
 * **first-level subdomains only**; `web.storefront.example.com` is a second
 * level and needs Advanced Certificate Manager, a paid add-on. The same holds
 * for the automatic domains: a certificate for `*.1-2-3-4.sslip.io` cannot
 * cover `web.demo.1-2-3-4.sslip.io`. Keeping the whole name in one label means
 * a single wildcard — one the operator already has — covers every project this
 * gateway will ever route.
 *
 * See docs/development/adr/0023-flat-hostname-labels.md.
 */

/** A single DNS label may not exceed 63 octets (RFC 1035). */
export const MAX_LABEL = 63

export const COMPONENT_SEPARATOR = '--'

export interface HostLabelParts {
  project: string
  service: string
  /** Branch, pull request, preview — anything that distinguishes one run. */
  context?: string | null
}

/**
 * A short, stable digest, used only to keep two long names apart.
 *
 * FNV-1a: four lines, no dependency, and no cryptographic claim — the only
 * property needed is that two different inputs rarely collide, which for the
 * handful of names one gateway serves is comfortably enough.
 */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(6, '0').slice(-6)
}

/**
 * Trim a label to fit, keeping a digest of what was removed.
 *
 * A label that is simply cut loses the part that made it distinct — two long
 * branch names would collapse onto the same hostname and silently route to
 * whichever container Traefik matched first. Replacing the tail with a digest
 * of the *whole* original keeps them apart.
 */
export function fitLabel(label: string, limit = MAX_LABEL): string {
  if (label.length <= limit) return label
  const digest = shortHash(label)
  const keep = limit - digest.length - 1
  return `${label.slice(0, keep).replace(/-+$/, '')}-${digest}`
}

/**
 * The label a service answers on, before the base domain.
 *
 * Every component is slugged first, so an input like `feature/auth/login`
 * becomes `feature-auth-login` and can never introduce a stray `--` that would
 * be read back as a component boundary. Without a context this is exactly
 * what Traefik's defaultRule produces, so the two never disagree.
 */
export function hostLabel(parts: HostLabelParts): string {
  const project = slug(parts.project)
  const service = slug(parts.service)
  const context = parts.context ? slug(parts.context) : ''
  const base = service ? `${project}-${service}` : project
  return fitLabel(context ? `${base}${COMPONENT_SEPARATOR}${context}` : base)
}
