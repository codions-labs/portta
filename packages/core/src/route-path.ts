// A route pattern against a request path, the one way Portta matches both.
//
// Used where a router is not: the WebSocket upgrade, the host daemon's sockets
// and the table of routes a module proxy may forward. Only `:name` segments and
// a trailing `*` exist, because a pattern that needs more is a pattern worth a
// router of its own.

/**
 * `/ws/environments/:name/logs` against `/ws/environments/shop/logs`.
 *
 * A trailing `*` matches the rest of the path, including nothing, and binds it
 * as `*`. Named segments are decoded, and an empty one never matches.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/')
  const actual = path.split('/')
  const rest = expected.at(-1) === '*'
  if (rest ? actual.length < expected.length - 1 : expected.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (const [index, segment] of expected.entries()) {
    if (rest && index === expected.length - 1) {
      params['*'] = actual.slice(index).join('/')
      break
    }
    const value = actual[index] ?? ''
    if (segment.startsWith(':')) {
      if (value === '') return null
      params[segment.slice(1)] = decodeURIComponent(value)
      continue
    }
    if (segment !== value) return null
  }
  return params
}
