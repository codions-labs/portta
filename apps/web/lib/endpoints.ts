// The order addresses are shown in, everywhere they are shown.

import type { RouteUrl, UrlScope } from 'portta-contracts'

const SCOPE_ORDER: Record<UrlScope, number> = { local: 0, vpn: 1, public: 2 }
const SCHEME_ORDER: Record<RouteUrl['scheme'], number> = { https: 0, http: 1 }

/** Nearest first, then https before http, then alphabetical so a list is stable. */
export function orderEndpoints(urls: readonly RouteUrl[]): RouteUrl[] {
  return [...urls].sort(
    (left, right) =>
      SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope] ||
      SCHEME_ORDER[left.scheme] - SCHEME_ORDER[right.scheme] ||
      left.url.localeCompare(right.url),
  )
}

/** The one address to open when the user does not choose: the first in that order. */
export function primaryEndpoint(urls: readonly RouteUrl[]): RouteUrl | null {
  return orderEndpoints(urls)[0] ?? null
}
