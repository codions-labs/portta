/**
 * A page on another site can target a loopback panel. Browser writes and
 * WebSocket upgrades therefore share one explicit same-origin decision.
 * Requests without Origin remain valid for CLI and token clients.
 */
export function originAllowed(origin: string, host: string, trusted: readonly string[]): boolean {
  if (origin === '') return true
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.host === host) return true
  if (trusted.includes(parsed.origin)) return true
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
}
