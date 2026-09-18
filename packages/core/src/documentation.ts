/** The versioned knowledge model. No filesystem, HTTP or rendering dependencies. */
export type DocsAudience = 'user' | 'developer'
export interface DocumentationHeading {
  id: string
  text: string
  level: number
  line: number
}
export interface DocumentationPage {
  slug: string
  title: string
  description: string
  audience: DocsAudience
  section: string
  category: string
  source: string
  url: string
  markdown: string
  text: string
  headings: DocumentationHeading[]
  kind: 'markdown' | 'api'
}
export interface DocumentationGroup {
  title: string
  category: string
  audience: DocsAudience
  sequential: boolean
  slugs: string[]
}
export interface DocumentationIdentity {
  version: string
  revision: string | null
  hash: string
}
export interface DocumentationCorpus {
  schemaVersion: 1
  identity: DocumentationIdentity
  groups: DocumentationGroup[]
  pages: DocumentationPage[]
  aliases: Record<string, string>
}
export interface DocumentationHit {
  slug: string
  title: string
  description: string
  audience: DocsAudience
  section: string
  category: string
  url: string
  anchor: string | null
  excerpt: string
}
export interface DocumentationSearchOptions {
  audience?: DocsAudience | 'all'
  limit?: number
}

const normalize = (text: string): string =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Stable, shared ranking; a query must match every word somewhere in the page. */
export function searchDocumentation(
  pages: readonly DocumentationPage[],
  query: string,
  options: DocumentationSearchOptions = {},
): DocumentationHit[] {
  const q = normalize(query)
  if (!q) return []
  const words = q.split(' ')
  return pages
    .flatMap((page, order) => {
      if (options.audience && options.audience !== 'all' && page.audience !== options.audience) return []
      const title = normalize(page.title)
      const description = normalize(page.description)
      const body = normalize(page.text)
      const heading = page.headings.find((h) => normalize(h.text).includes(q))
      const haystack = `${title} ${description} ${body} ${page.slug} ${page.headings.map((h) => normalize(h.text)).join(' ')}`
      if (!words.every((word) => haystack.includes(word))) return []
      const score =
        title === q
          ? 100
          : title.startsWith(q)
            ? 90
            : title.includes(q)
              ? 80
              : heading
                ? 60
                : description.includes(q)
                  ? 40
                  : 20
      const anchor = score < 80 ? (heading?.id ?? null) : null
      const position = body.indexOf(q)
      const excerpt =
        score >= 40 ? page.description : body.slice(Math.max(0, position - 60), Math.max(0, position - 60) + 220)
      return [
        {
          order,
          score,
          hit: {
            slug: page.slug,
            title: page.title,
            description: page.description,
            audience: page.audience,
            section: page.section,
            category: page.category,
            url: `${page.url}${anchor ? `#${anchor}` : ''}`,
            anchor,
            excerpt,
          },
        },
      ]
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.min(50, Math.max(1, options.limit ?? 10)))
    .map(({ hit }) => hit)
}

export function getDocumentationPage(
  corpus: DocumentationCorpus,
  slug: string,
  anchor?: string,
): DocumentationPage | undefined {
  const page = corpus.pages.find((entry) => entry.slug === (corpus.aliases[slug] ?? slug))
  if (!page || !anchor) return page
  const index = page.headings.findIndex((heading) => heading.id === anchor)
  const heading = page.headings[index]
  if (!heading) return undefined
  const next = page.headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
  return {
    ...page,
    url: `${page.url}#${anchor}`,
    markdown: page.markdown.split('\n').slice(heading.line, next?.line).join('\n'),
    headings: page.headings.filter(
      (candidate) => candidate.line >= heading.line && (!next || candidate.line < next.line),
    ),
  }
}

export function documentationNavigation(corpus: DocumentationCorpus, audience: DocsAudience | 'all' = 'all') {
  return {
    identity: corpus.identity,
    groups: corpus.groups.filter((group) => audience === 'all' || group.audience === audience),
    pages: corpus.pages
      .filter((page) => audience === 'all' || page.audience === audience)
      .map(({ markdown, text, headings, ...metadata }) => metadata),
  }
}
