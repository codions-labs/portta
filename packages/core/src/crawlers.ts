// Which crawlers may read a hostname Portta routes.
//
// A crawler that follows robots.txt is asked not to come in, and one that does
// not is refused at the gateway by the name it gives itself. Neither stops a
// client that lies about what it is, which is why the answer for a host that
// asks for a login never depends on this.

export const CRAWLER_KINDS = ['search', 'train', 'live', 'preview'] as const
export type CrawlerKind = (typeof CRAWLER_KINDS)[number]

/** `true` lets that kind of crawler read the host. */
export type CrawlerPolicy = Record<CrawlerKind, boolean>

export const BLOCK_ALL_CRAWLERS: CrawlerPolicy = { search: false, train: false, live: false, preview: false }

/** The product token each kind answers to, as it is written in robots.txt. */
export const CRAWLER_TOKENS: Record<CrawlerKind, readonly string[]> = {
  search: ['Googlebot', 'Bingbot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot', 'Slurp'],
  train: [
    'GPTBot',
    'ClaudeBot',
    'anthropic-ai',
    'CCBot',
    'Google-Extended',
    'Bytespider',
    'Meta-ExternalAgent',
    'Amazonbot',
    'cohere-ai',
    'Diffbot',
  ],
  live: ['ChatGPT-User', 'OAI-SearchBot', 'Claude-User', 'Claude-Web', 'PerplexityBot', 'Perplexity-User'],
  preview: ['Slackbot', 'facebookexternalhit', 'Twitterbot', 'WhatsApp', 'LinkedInBot', 'Discordbot', 'TelegramBot'],
}

export function parseCrawlerPolicy(value: unknown): CrawlerPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid crawler policy')
  const item = value as Record<string, unknown>
  const policy = { ...BLOCK_ALL_CRAWLERS }
  for (const key of Object.keys(item)) {
    if (!(CRAWLER_KINDS as readonly string[]).includes(key)) throw new Error(`unknown crawler kind: ${key}`)
  }
  for (const kind of CRAWLER_KINDS) {
    const entry = item[kind]
    if (entry === undefined) continue
    if (typeof entry !== 'boolean') throw new Error(`invalid crawler policy: ${kind}`)
    policy[kind] = entry
  }
  return policy
}

export function allowsEveryCrawler(policy: CrawlerPolicy): boolean {
  return CRAWLER_KINDS.every((kind) => policy[kind])
}

export function blocksEveryCrawler(policy: CrawlerPolicy): boolean {
  return CRAWLER_KINDS.every((kind) => !policy[kind])
}

export function sameCrawlerPolicy(left: CrawlerPolicy, right: CrawlerPolicy): boolean {
  return CRAWLER_KINDS.every((kind) => left[kind] === right[kind])
}

/** What a request calls itself, or null when it is not one of the crawlers Portta knows. */
export function crawlerKindOf(userAgent: string | null | undefined): CrawlerKind | null {
  if (!userAgent) return null
  const agent = userAgent.toLowerCase()
  for (const kind of CRAWLER_KINDS) {
    if (CRAWLER_TOKENS[kind].some((token) => agent.includes(token.toLowerCase()))) return kind
  }
  return null
}

/** True when a request that gives this name may be answered under the policy. */
export function crawlerMayRead(policy: CrawlerPolicy, userAgent: string | null | undefined): boolean {
  const kind = crawlerKindOf(userAgent)
  return kind === null || policy[kind]
}

/**
 * The robots.txt a host with this policy answers with, or null when everything
 * is allowed and the application's own file, if it has one, should be left alone.
 */
export function renderRobots(policy: CrawlerPolicy): string | null {
  if (allowsEveryCrawler(policy)) return null
  if (blocksEveryCrawler(policy)) return 'User-agent: *\nDisallow: /\n'
  const groups = CRAWLER_KINDS.filter((kind) => !policy[kind]).flatMap((kind) =>
    CRAWLER_TOKENS[kind].map((token) => `User-agent: ${token}\nDisallow: /\n`),
  )
  return groups.join('\n')
}
