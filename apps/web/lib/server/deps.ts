// How a Server Component reaches the panel's services.
//
// A page renders inside the same process that opened the Docker client, the
// database pool and the event hub — but Next loads `app/` through its own
// module graph, so an import from `server/main.ts` would give the page a second
// copy of every one of them: two pools, two Docker event subscriptions, two
// snapshot caches.
//
// `globalThis` is the one place both graphs can see. `server/main.ts` puts the
// composed dependencies there before it prepares Next, and this module is the
// only thing that reads them back. That is the whole reason it exists; nothing
// else in the panel touches `globalThis`.
//
// A Server Component calls `services.*` directly. It never fetches its own API:
// the request would leave the process, come back through the same dispatcher,
// and pay for a round trip to reach code it already has.

import type { AppDeps } from 'portta-server'

const KEY = '__portta_deps'

interface Host {
  [KEY]?: AppDeps
}

/** Called once by the entry point, before Next is prepared. */
export function registerDeps(deps: AppDeps): void {
  ;(globalThis as Host)[KEY] = deps
}

/**
 * The composed dependencies, or a clear failure.
 *
 * Absent means a page is rendering outside `server/main.ts` — `next build`
 * pre-rendering, or a test that forgot to register them — and the honest
 * answer is to say which, not to build a half-working second panel.
 */
export function serverDeps(): AppDeps {
  const deps = (globalThis as Host)[KEY]
  if (!deps) {
    throw new Error(
      'the panel’s dependencies are not registered: a page rendered outside server/main.ts. ' +
        'Run the panel with `npm run dev --workspace=portta-web`, or mark the page dynamic.',
    )
  }
  return deps
}

/** Whether they are there, for a page that can render a placeholder without them. */
export function hasDeps(): boolean {
  return (globalThis as Host)[KEY] !== undefined
}
