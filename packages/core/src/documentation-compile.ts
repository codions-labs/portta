/** Pure compilation: callers provide source strings and repository paths. */
import MarkdownIt from 'markdown-it'
import type {
  DocumentationCorpus,
  DocumentationHeading,
  DocumentationIdentity,
  DocumentationPage,
} from './documentation.ts'
import { z } from './zod.ts'

const label = z.string().trim().min(1)
const slug = z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/)
const entry = z
  .object({
    source: label.optional(),
    slug,
    description: label,
    kind: z.literal('api').optional(),
    title: label.optional(),
  })
  .strict()
export const DocumentationManifest = z
  .object({
    groups: z
      .array(
        z
          .object({
            title: label,
            category: z.string(),
            audience: z.enum(['user', 'developer']),
            sequential: z.boolean().default(false),
            pages: z.array(entry).min(1),
          })
          .strict(),
      )
      .min(1),
    aliases: z.record(z.string(), z.string()).default({}),
  })
  .strict()

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}
export function headingText(children: Array<{ type: string; content: string }> | null | undefined): string {
  return (children ?? [])
    .filter((child) => ['text', 'code_inline', 'image'].includes(child.type))
    .map((child) => child.content)
    .join('')
}
export const markdownParser = () => new MarkdownIt({ html: true, linkify: false, typographer: false })

export function parseDocumentation(markdown: string) {
  const tokens = markdownParser().parse(markdown, {})
  const headings: DocumentationHeading[] = []
  const used = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type !== 'heading_open') continue
    const text = headingText(tokens[i + 1]?.children)
    const base = headingId(text)
    let id = base
    for (let suffix = 1; used.has(id); suffix++) id = `${base}-${suffix}`
    used.add(id)
    token.attrSet('id', id)
    headings.push({ id, text, level: Number(token.tag.slice(1)), line: token.map?.[0] ?? 0 })
  }
  const text = tokens
    .filter((token) => token.type === 'inline')
    .map((token) => headingText(token.children))
    .join(' ')
    .replace(/\s+/g, ' ')
  return { tokens, headings, text }
}

/** Resolve repository-relative links without touching the filesystem. */
export function resolveDocPath(from: string, href: string): string {
  const parts = `${from.split('/').slice(0, -1).join('/')}/${href}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!out.length) throw new Error(`link escapes repository: ${from}: ${href}`)
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}
/** `moduleRoots` are the documentation directories of official modules, publishable like `docs/product` and `docs/development`. */
export function compileDocumentation(
  rawManifest: unknown,
  sources: Record<string, string>,
  identity: DocumentationIdentity,
  moduleRoots: readonly string[] = [],
): DocumentationCorpus {
  const manifest = DocumentationManifest.parse(rawManifest)
  const seen = new Set<string>()
  const paths = new Set<string>()
  const groups = new Set<string>()
  const pages: DocumentationPage[] = []
  for (const group of manifest.groups) {
    const key = `${group.audience}/${group.title}/${group.category}`
    if (groups.has(key)) throw new Error(`duplicate documentation category: ${key}`)
    groups.add(key)
    for (const item of group.pages) {
      if (seen.has(item.slug) || ['images', 'README'].includes(item.slug) || item.slug.startsWith('images/'))
        throw new Error(`duplicate or reserved documentation slug: ${item.slug}`)
      seen.add(item.slug)
      if (item.kind === 'api') {
        if (item.slug !== 'api' || item.source || !item.title)
          throw new Error('API entry requires title and slug api, without a Markdown source')
      } else {
        if (
          !item.source ||
          !(
            item.source.startsWith(`docs/${group.audience === 'user' ? 'product' : 'development'}/`) ||
            item.source === 'CHANGELOG.md' ||
            moduleRoots.some((directory) => (item.source ?? '').startsWith(`${directory}/`))
          )
        )
          throw new Error(`internal source cannot be published: ${item.source}`)
        if (paths.has(item.source)) throw new Error(`duplicate documentation source: ${item.source}`)
        if (sources[item.source] === undefined) throw new Error(`missing documentation source: ${item.source}`)
        paths.add(item.source)
        if (item.title || item.slug === 'api') throw new Error(`Markdown title must come from H1: ${item.slug}`)
      }
      const markdown = item.source
        ? sources[item.source]!
        : '# API reference\n\nThe OpenAPI contract of this panel is available at /api/openapi.json.\n'
      const parsed = parseDocumentation(markdown)
      if (parsed.headings.filter((heading) => heading.level === 1).length !== 1)
        throw new Error(`exactly one H1 required: ${item.source}`)
      pages.push({
        slug: item.slug,
        title: item.title ?? parsed.headings.find((heading) => heading.level === 1)!.text,
        description: item.description,
        source: item.source ?? 'packages/contracts/openapi.json',
        audience: group.audience,
        section: group.title,
        category: group.category,
        url: `/docs/${item.slug}`,
        markdown,
        text: parsed.text,
        headings: parsed.headings,
        kind: item.kind ?? 'markdown',
      })
    }
  }
  for (const source of Object.keys(sources))
    if (
      (/^docs\/(product|development)\/.+\.md$/.test(source) ||
        moduleRoots.some((directory) => source.startsWith(`${directory}/`) && source.endsWith('.md'))) &&
      !paths.has(source)
    )
      throw new Error(`unclassified documentation: ${source}`)
  for (const [alias, target] of Object.entries(manifest.aliases)) {
    if (!seen.has(target) || seen.has(alias) || !slug.safeParse(alias).success || alias === 'images')
      throw new Error(`invalid documentation alias: ${alias} → ${target}`)
  }
  return {
    schemaVersion: 1,
    identity,
    pages,
    aliases: manifest.aliases,
    groups: manifest.groups.map(({ pages: entries, ...group }) => ({
      ...group,
      slugs: entries.map((page) => page.slug),
    })),
  }
}

/** Validate all local links (including raw HTML), anchors and assets before shipping. */
export function validateDocumentation(
  corpus: DocumentationCorpus,
  repositoryFiles: readonly string[],
  extraSources: Record<string, string> = {},
  verifyRepositoryLinks = true,
): void {
  const files = new Set(repositoryFiles)
  const bySource = new Map(corpus.pages.map((page) => [page.source, page]))
  const bySlug = new Map(corpus.pages.map((page) => [page.slug, page]))
  const errors = new Set<string>()
  const check = (href: string, source: string, image: boolean): void => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
      if (image) errors.add(`${source}: remote image ${href}`)
      return
    }
    const [raw = '', fragment] = href.split('#')
    const path = decodeURIComponent(raw.split('?')[0]!)
    const anchor = fragment ? decodeURIComponent(fragment) : ''
    let page: DocumentationPage | undefined
    if (path.startsWith('/docs/')) page = bySlug.get(corpus.aliases[path.slice(6)] ?? path.slice(6))
    else if (path.startsWith('/'))
      return // application routes are checked at their owning boundary
    else {
      const target = path ? resolveDocPath(source, path) : source
      if (image) {
        if (!target.startsWith('docs/images/') || !files.has(target))
          errors.add(`${source}: missing or unbundled image ${href}`)
        return
      }
      page = bySource.get(target) ?? bySource.get(`${target}/README.md`)
      if (
        !page &&
        (verifyRepositoryLinks || /^docs\/(product|development)\//.test(target)) &&
        !files.has(target) &&
        !repositoryFiles.some((file) => file.startsWith(`${target}/`))
      )
        errors.add(`${source}: missing target ${href}`)
      if (!page && anchor && extraSources[target]) {
        if (!parseDocumentation(extraSources[target]!).headings.some((heading) => heading.id === anchor))
          errors.add(`${source}: missing anchor ${href}`)
      }
    }
    if (path.startsWith('/docs/') && !page) errors.add(`${source}: missing route ${href}`)
    if (page && anchor && !page.headings.some((heading) => heading.id === anchor))
      errors.add(`${source}: missing anchor ${href}`)
  }
  const scan = (source: string, markdown: string) => {
    const { tokens } = parseDocumentation(markdown)
    for (const token of tokens) {
      for (const child of token.children ?? []) {
        if (child.type === 'link_open') check(child.attrGet('href') ?? '', source, false)
        if (child.type === 'image') check(child.attrGet('src') ?? '', source, true)
      }
      for (const html of [token, ...(token.children ?? [])].filter(
        (item) => item.type === 'html_block' || item.type === 'html_inline',
      )) {
        for (const match of html.content.matchAll(/\b(href|src)\s*=\s*["']([^"']+)["']/gi))
          check(match[2]!, source, match[1]!.toLowerCase() === 'src')
      }
    }
  }
  for (const page of corpus.pages) if (page.kind === 'markdown') scan(page.source, page.markdown)
  for (const [source, markdown] of Object.entries(extraSources)) scan(source, markdown)
  if (errors.size) throw new Error(`Invalid documentation:\n${[...errors].join('\n')}`)
}
