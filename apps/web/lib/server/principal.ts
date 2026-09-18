import 'server-only'
import { headers } from 'next/headers'
import type { Principal } from 'portta-auth-core'
import { registeredPrincipals } from './principal-registry.ts'

// A page's half of authorisation.
//
// `(panel)/layout.tsx` is the one entrance every page comes through, so the
// check lives there and every page below it can assume a principal. There is no
// middleware: a `proxy.ts` would run on every asset, could not reach the
// database, and would duplicate a decision this already makes once per render.
//
// It lives in the panel rather than in portta-auth-core because `next/headers`
// only resolves under a bundler, and a package that the CLI and the server also
// load must not depend on one.

export async function getPrincipal(): Promise<Principal | null> {
  const resolver = registeredPrincipals()
  if (!resolver) return null
  return resolver.fromHeaders(await headers())
}

/**
 * The principal, or nothing.
 *
 * The caller decides what "nothing" means — a redirect to `/sign-in` in the
 * panel layout — because a thrown error here would render an error page where
 * a sign-in page belongs.
 */
export async function requirePrincipal(): Promise<Principal | null> {
  return getPrincipal()
}
