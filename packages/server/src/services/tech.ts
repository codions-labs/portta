// Technology identity for the panel. Separate from ServiceKind (access
// protocol): nginx and whoami are both HTTP, but they look different.

import type { ServiceTech } from 'portta-contracts'

const FALLBACK: ServiceTech = { id: 'docker', label: 'Container' }

/**
 * Strip registry, tag and digest so `ghcr.io/library/postgres:18-alpine` and
 * `postgres:18.6-alpine` both reduce to `postgres`.
 */
export function normalizeImageRepo(image: string): string {
  let value = (image ?? '').trim().toLowerCase()
  if (!value) return ''

  const at = value.indexOf('@')
  if (at >= 0) value = value.slice(0, at)

  // Tag after the last slash segment: keep host:port/repo intact until then.
  const slash = value.lastIndexOf('/')
  const afterSlash = slash >= 0 ? value.slice(slash + 1) : value
  const colon = afterSlash.lastIndexOf(':')
  if (colon >= 0) {
    value = slash >= 0 ? `${value.slice(0, slash + 1)}${afterSlash.slice(0, colon)}` : afterSlash.slice(0, colon)
  }

  // Drop well-known registry prefixes and the Docker Hub `library/` namespace.
  value = value
    .replace(/^docker\.io\//, '')
    .replace(/^registry-1\.docker\.io\//, '')
    .replace(/^ghcr\.io\//, '')
    .replace(/^quay\.io\//, '')
    .replace(/^gcr\.io\//, '')
    .replace(/^public\.ecr\.aws\//, '')
    .replace(/^library\//, '')

  // host:port/org/name or org/name → take the last path segment for matching.
  const parts = value.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? value
}

type TechRule = { match: RegExp; id: string; label: string }

/** First match wins. Prefer specific product names over language runtimes. */
const IMAGE_RULES: TechRule[] = [
  { match: /postgres|postgis|timescale/, id: 'postgres', label: 'PostgreSQL' },
  { match: /mysql|mariadb|percona/, id: 'mysql', label: 'MySQL' },
  { match: /redis|valkey|keydb/, id: 'redis', label: 'Redis' },
  { match: /mongo/, id: 'mongodb', label: 'MongoDB' },
  { match: /nginx/, id: 'nginx', label: 'Nginx' },
  { match: /mailpit|mailhog/, id: 'mailpit', label: 'Mailpit' },
  { match: /rustfs|minio/, id: 's3', label: 'S3' },
  { match: /traefik/, id: 'traefik', label: 'Traefik' },
  { match: /^node$|nodedotjs|nodejs/, id: 'node', label: 'Node.js' },
  { match: /^php$|php-fpm|php-cli/, id: 'php', label: 'PHP' },
  { match: /^python$|python3/, id: 'python', label: 'Python' },
  { match: /rabbitmq/, id: 'amqp', label: 'RabbitMQ' },
  { match: /elasticsearch|opensearch/, id: 'search', label: 'Search' },
  { match: /memcached/, id: 'memcached', label: 'Memcached' },
  { match: /clickhouse/, id: 'clickhouse', label: 'ClickHouse' },
  { match: /^docker$|docker-socket-proxy|socket-proxy/, id: 'docker', label: 'Docker' },
]

/** Service-name hints when the image is a custom build or whoami. */
const SERVICE_RULES: TechRule[] = [
  { match: /postgres|pgsql|pg$/, id: 'postgres', label: 'PostgreSQL' },
  { match: /mysql|mariadb/, id: 'mysql', label: 'MySQL' },
  { match: /redis|valkey|cache/, id: 'redis', label: 'Redis' },
  { match: /mongo/, id: 'mongodb', label: 'MongoDB' },
  { match: /nginx|proxy/, id: 'nginx', label: 'Nginx' },
  { match: /mailpit|mailhog|mail|smtp/, id: 'mailpit', label: 'Mailpit' },
  { match: /rustfs|minio|s3|object.?storage/, id: 's3', label: 'S3' },
  { match: /traefik/, id: 'traefik', label: 'Traefik' },
]

function matchRules(haystack: string, rules: TechRule[]): ServiceTech | null {
  for (const rule of rules) {
    if (rule.match.test(haystack)) return { id: rule.id, label: rule.label }
  }
  return null
}

/**
 * Resolve a discrete technology for a container from its image, Compose
 * service name and a few well-known OCI labels. Always returns something:
 * unknown images fall back to the generic Docker/container identity.
 */
export function resolveServiceTech(input: {
  image?: string | null
  service?: string | null
  labels?: Record<string, string> | null
}): ServiceTech {
  const image = input.image ?? ''
  const repo = normalizeImageRepo(image)
  // Match only the image name (last path segment), never the org: otherwise
  // `traefik/whoami` would be labelled Traefik.
  const fromImage = matchRules(repo, IMAGE_RULES)
  if (fromImage) return fromImage

  const service = (input.service ?? '').toLowerCase()
  const fromService = matchRules(service, SERVICE_RULES)
  if (fromService) return fromService

  const labels = input.labels ?? {}
  const title = (labels['org.opencontainers.image.title'] ?? '').toLowerCase()
  if (title) {
    const fromTitle = matchRules(title, IMAGE_RULES) ?? matchRules(title, SERVICE_RULES)
    if (fromTitle) return fromTitle
  }

  return FALLBACK
}
