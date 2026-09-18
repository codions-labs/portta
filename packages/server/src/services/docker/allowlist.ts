// The panel talks to the Docker Engine API through its own socket proxy, which
// already denies most endpoints. This is the second layer: the panel refuses to
// emit a request that is not on this list, so a bug in a route handler cannot
// turn into an arbitrary Docker call.
//
// Anything absent from this list is denied, including endpoints the proxy would
// technically forward (`/containers/prune`,
// `/containers/{id}/archive`, `/networks/{id}/connect`, ...).

export interface AllowRule {
  method: 'GET' | 'POST' | 'DELETE'
  pattern: RegExp
  purpose: string
}

const ID = '[a-zA-Z0-9][a-zA-Z0-9_.-]*'

export const ALLOWED_ENDPOINTS: AllowRule[] = [
  { method: 'GET', pattern: /^\/_ping$/, purpose: 'liveness of the Docker daemon' },
  { method: 'GET', pattern: /^\/version$/, purpose: 'engine version' },
  { method: 'GET', pattern: /^\/info$/, purpose: 'host overview counters' },
  { method: 'GET', pattern: /^\/events$/, purpose: 'live updates' },
  { method: 'GET', pattern: /^\/containers\/json$/, purpose: 'list containers' },
  { method: 'GET', pattern: new RegExp(`^/containers/${ID}/json$`), purpose: 'inspect a container' },
  { method: 'GET', pattern: new RegExp(`^/containers/${ID}/logs$`), purpose: 'recent logs' },
  { method: 'GET', pattern: new RegExp(`^/containers/${ID}/stats$`), purpose: 'one-shot resource usage' },
  { method: 'GET', pattern: /^\/networks$/, purpose: 'list networks' },
  { method: 'GET', pattern: new RegExp(`^/networks/${ID}$`), purpose: 'inspect a network' },
  { method: 'POST', pattern: new RegExp(`^/containers/${ID}/start$`), purpose: 'start a container' },
  { method: 'POST', pattern: new RegExp(`^/containers/${ID}/stop$`), purpose: 'stop a container' },
  { method: 'POST', pattern: new RegExp(`^/containers/${ID}/restart$`), purpose: 'restart a container' },
  {
    method: 'POST',
    pattern: new RegExp(`^/containers/${ID}/exec$`),
    purpose: 'create a scoped interactive console exec',
  },
  { method: 'POST', pattern: new RegExp(`^/exec/${ID}/start$`), purpose: 'attach the console byte stream' },
  { method: 'POST', pattern: new RegExp(`^/exec/${ID}/resize$`), purpose: 'resize the console terminal' },
  { method: 'GET', pattern: new RegExp(`^/exec/${ID}/json$`), purpose: 'inspect console exit and teardown state' },
  { method: 'POST', pattern: /^\/containers\/create$/, purpose: 'create a TCP access bridge, and nothing else' },
  { method: 'DELETE', pattern: new RegExp(`^/containers/${ID}$`), purpose: 'remove a container, never its volumes' },
]

export class DockerAccessDenied extends Error {
  constructor(method: string, path: string) {
    super(`the panel does not allow ${method} ${path} on the Docker API`)
    this.name = 'DockerAccessDenied'
  }
}

export function isAllowed(method: string, path: string): boolean {
  if (path.includes('..') || path.includes('//') || path.includes('%')) return false
  return ALLOWED_ENDPOINTS.some((rule) => rule.method === method && rule.pattern.test(path))
}

export function assertAllowed(method: string, path: string): void {
  if (!isAllowed(method, path)) throw new DockerAccessDenied(method, path)
}

/** Container and network ids as Docker itself spells them, plus Compose names. */
export function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id)
}

export function assertValidId(id: string): string {
  if (!isValidId(id)) throw new Error(`invalid container or network id: ${id}`)
  return id
}
