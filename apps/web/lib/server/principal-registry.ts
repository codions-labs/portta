import type { PrincipalResolver } from 'portta-auth-core'

// Where the process leaves the resolver for the pages to find.
//
// Separate from `principal.ts`, which reads it, because that file imports
// `next/headers` — a module that only exists inside Next's own bundle. The
// process entry point is plain Node ESM: importing it there fails at load, so
// the half `server/main.ts` needs lives here, on its own.
//
// See lib/server/deps.ts, which is a global for the same reason: Next loads
// `app/` through a module graph of its own.

const KEY = '__portta_principals'

interface Host {
  [KEY]?: PrincipalResolver
}

/** Called once by the entry point, before Next is prepared. */
export function registerPrincipals(resolver: PrincipalResolver): void {
  ;(globalThis as Host)[KEY] = resolver
}

export function registeredPrincipals(): PrincipalResolver | null {
  return (globalThis as Host)[KEY] ?? null
}
