// Asking a service's panel to open its console, from elsewhere in this tab.
//
// Kept in this tab's session, for one use and a few seconds, because going there
// reloads the page. Not a URL parameter on purpose: a shell inside a container must
// never start because of a link somebody followed, and another site cannot write here.

const KEY = 'portta-console-request'
const VALID_MS = 10_000

export function requestConsole(environment: string, service: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ target: `${environment}/${service}`, at: Date.now() }))
  } catch {
    // Without storage the service still opens, and its console is one click away.
  }
}

export function takeConsoleRequest(environment: string, service: string | null): boolean {
  try {
    const stored = window.sessionStorage.getItem(KEY)
    if (!stored) return false
    window.sessionStorage.removeItem(KEY)
    const { target, at } = JSON.parse(stored) as { target?: unknown; at?: unknown }
    return target === `${environment}/${service}` && typeof at === 'number' && Date.now() - at < VALID_MS
  } catch {
    return false
  }
}
