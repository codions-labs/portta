// What a container's Traefik labels route, read the way Traefik reads them.
//
// Traefik takes label keys in any case, `traefik.enable` as any boolean Go parses,
// and a rule as an expression. Reading less than that means the panel can call an
// address gated, closed or absent while a router it failed to read answers it.

const ENABLED = new Set(['1', 't', 'true'])
const HTTP_ROUTER = /^traefik\.http\.routers\.([^.]+)\./
const TCP_ROUTER = /^traefik\.tcp\.routers\.([^.]+)\./
/** The spellings Traefik registers for a matcher: as written, lower, upper and title case. */
const HOST_MATCHER = new Set(['Host', 'host', 'HOST'])

export interface TraefikLabels {
  labels: Record<string, string>
  /** One setting spelled in two cases with two values: nobody can say which applies. */
  ambiguous: boolean
}

export function readTraefikLabels(source: Record<string, string>): TraefikLabels {
  const labels: Record<string, string> = {}
  let ambiguous = false
  for (const [key, value] of Object.entries(source)) {
    const normalized = key.toLowerCase()
    if (normalized.startsWith('traefik.') && normalized in labels && labels[normalized] !== value) ambiguous = true
    labels[normalized] = value
  }
  return { labels, ambiguous }
}

export function traefikEnabled(source: Record<string, string>): boolean {
  return ENABLED.has((readTraefikLabels(source).labels['traefik.enable'] ?? '').trim().toLowerCase())
}

export function httpRouterNames(labels: Record<string, string>): string[] {
  return [...new Set(Object.keys(labels).map((key) => HTTP_ROUTER.exec(key)?.[1]))].filter(
    (name): name is string => name !== undefined,
  )
}

export function tcpRouterNames(labels: Record<string, string>): string[] {
  return [...new Set(Object.keys(labels).map((key) => TCP_ROUTER.exec(key)?.[1]))].filter(
    (name): name is string => name !== undefined,
  )
}

/** A container carries TCP router labels and no HTTP ones. */
export function isTcpOnly(source: Record<string, string>): boolean {
  const keys = Object.keys(readTraefikLabels(source).labels)
  return (
    keys.some((key) => key.startsWith('traefik.tcp.routers.')) && !keys.some((key) => key.startsWith('traefik.http.'))
  )
}

export interface RuleHosts {
  /** Every name the rule can answer on, lowercase as Traefik compares them. */
  hosts: string[]
  /** It can also answer on names that cannot be listed: a regexp, a wildcard, no Host at all. */
  unknown: boolean
}

type Token = { kind: 'name' | 'string'; text: string } | { kind: '(' | ')' | ',' | '&&' | '||' | '!' }

function tokenize(rule: string): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < rule.length) {
    const char = rule[at] as string
    if (/\s/.test(char)) {
      at += 1
    } else if (char === '(' || char === ')' || char === ',' || char === '!') {
      tokens.push({ kind: char })
      at += 1
    } else if (rule.startsWith('&&', at) || rule.startsWith('||', at)) {
      tokens.push({ kind: rule.slice(at, at + 2) as '&&' | '||' })
      at += 2
    } else if (char === '`') {
      const end = rule.indexOf('`', at + 1)
      if (end < 0) throw new Error('unterminated string')
      tokens.push({ kind: 'string', text: rule.slice(at + 1, end) })
      at = end + 1
    } else if (char === '"') {
      // These are Go string literals, so `\x2e` is a dot. Nothing here decodes
      // that, and a name read wrong is worse than one not read: it fails closed.
      const match = /^"([^"\\]*)"/.exec(rule.slice(at))
      if (!match) throw new Error('unterminated or escaped string')
      tokens.push({ kind: 'string', text: match[1] as string })
      at += match[0].length
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rule.slice(at))
      if (!match) throw new Error(`unexpected ${char}`)
      tokens.push({ kind: 'name', text: match[0] })
      at += match[0].length
    }
  }
  return tokens
}

function either(left: RuleHosts, right: RuleHosts): RuleHosts {
  return { hosts: [...new Set([...left.hosts, ...right.hosts])], unknown: left.unknown || right.unknown }
}

function both(left: RuleHosts, right: RuleHosts): RuleHosts {
  // A side that can answer anywhere does not narrow the other: a Host next to a
  // path still answers on that one name.
  if (left.unknown && right.unknown) return either(left, right)
  if (left.unknown) return right
  if (right.unknown) return left
  return { hosts: left.hosts.filter((host) => right.hosts.includes(host)), unknown: false }
}

function parse(tokens: Token[]): RuleHosts {
  let at = 0
  const accept = (kind: Token['kind']) => {
    if (tokens[at]?.kind !== kind) return false
    at += 1
    return true
  }
  const expect = (kind: Token['kind']) => {
    if (!accept(kind)) throw new Error(`expected ${kind}`)
  }

  const matcher = (name: string): RuleHosts => {
    expect('(')
    const values: string[] = []
    do {
      const token = tokens[at]
      if (token?.kind !== 'string') throw new Error('expected a string')
      values.push(token.text)
      at += 1
    } while (accept(','))
    expect(')')
    if (!HOST_MATCHER.has(name)) return { hosts: [], unknown: true }
    const named = values.filter((value) => !value.includes('*')).map((value) => value.toLowerCase())
    return { hosts: named, unknown: named.length < values.length }
  }

  const unary = (): RuleHosts => {
    // What a negation leaves is every name but some, so it names none of them.
    if (accept('!')) {
      unary()
      return { hosts: [], unknown: true }
    }
    if (accept('(')) {
      const inner = any()
      expect(')')
      return inner
    }
    const token = tokens[at]
    if (token?.kind !== 'name') throw new Error('expected a matcher')
    at += 1
    return matcher(token.text)
  }
  const all = (): RuleHosts => {
    let left = unary()
    while (accept('&&')) left = both(left, unary())
    return left
  }
  const any = (): RuleHosts => {
    let left = all()
    while (accept('||')) left = either(left, all())
    return left
  }

  const result = any()
  if (at !== tokens.length) throw new Error('trailing input')
  return result
}

/** What one rule answers on. A rule that cannot be read is treated as answering anywhere. */
export function ruleHosts(rule: string): RuleHosts {
  try {
    return parse(tokenize(rule))
  } catch {
    return { hosts: [], unknown: true }
  }
}

export interface HttpRoutes {
  hosts: string[]
  /** A router with no rule, or no router at all: Traefik derives the name itself. */
  usesDefaultRule: boolean
  /** Some router can answer on names that cannot be listed. */
  unknownHosts: boolean
}

export function httpRoutes(source: Record<string, string>): HttpRoutes {
  const { labels, ambiguous } = readTraefikLabels(source)
  const routes: HttpRoutes = { hosts: [], usesDefaultRule: false, unknownHosts: ambiguous }
  const routers = httpRouterNames(labels).sort()
  if (routers.length === 0) routes.usesDefaultRule = true
  for (const name of routers) {
    const rule = labels[`traefik.http.routers.${name}.rule`]?.trim()
    if (!rule) {
      routes.usesDefaultRule = true
      continue
    }
    const read = ruleHosts(rule)
    routes.hosts = [...new Set([...routes.hosts, ...read.hosts])]
    routes.unknownHosts ||= read.unknown
  }
  return routes
}
