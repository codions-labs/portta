import { describe, expect, it } from 'vitest'
import { BLOCK_ALL_CRAWLERS, crawlerKindOf, crawlerMayRead, parseCrawlerPolicy, renderRobots } from './crawlers.ts'
import { crawlersFor, emptyProtectionStore, parseProtectionStore, setDefaultCrawlers } from './protections.ts'

describe('crawler policy', () => {
  it('tells the crawlers apart by the name they give', () => {
    expect(crawlerKindOf('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('search')
    expect(crawlerKindOf('Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2)')).toBe('train')
    expect(crawlerKindOf('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('train')
    expect(crawlerKindOf('Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0')).toBe('live')
    expect(crawlerKindOf('Slackbot-LinkExpanding 1.0')).toBe('preview')
    expect(crawlerKindOf('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBeNull()
    expect(crawlerKindOf(undefined)).toBeNull()
  })

  it('refuses a blocked kind and lets everybody else through', () => {
    const policy = { ...BLOCK_ALL_CRAWLERS, search: true }
    expect(crawlerMayRead(policy, 'Googlebot/2.1')).toBe(true)
    expect(crawlerMayRead(policy, 'GPTBot/1.2')).toBe(false)
    expect(crawlerMayRead(policy, 'curl/8.4.0')).toBe(true)
  })

  it('asks every crawler to stay out when none may read, and names only the blocked ones otherwise', () => {
    expect(renderRobots(BLOCK_ALL_CRAWLERS)).toBe('User-agent: *\nDisallow: /\n')
    expect(renderRobots({ search: true, train: true, live: true, preview: true })).toBeNull()
    const partial = renderRobots({ search: true, train: false, live: true, preview: true }) ?? ''
    expect(partial).toContain('User-agent: GPTBot\nDisallow: /')
    expect(partial).not.toContain('Googlebot')
    expect(partial).not.toContain('User-agent: *')
  })

  it('refuses a policy it does not understand', () => {
    expect(() => parseCrawlerPolicy({ search: 'yes' })).toThrow()
    expect(() => parseCrawlerPolicy({ robots: true })).toThrow()
    expect(parseCrawlerPolicy({ search: true })).toEqual({ ...BLOCK_ALL_CRAWLERS, search: true })
  })

  it('blocks everything when the store says nothing, and keeps what it was told', () => {
    const empty = emptyProtectionStore()
    expect(crawlersFor(empty, {})).toEqual(BLOCK_ALL_CRAWLERS)
    const store = parseProtectionStore(
      JSON.stringify(setDefaultCrawlers(empty, { search: true, train: false, live: false, preview: false })),
    )
    expect(crawlersFor(store, { project: 'x' }).search).toBe(true)
  })
})
