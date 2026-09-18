import type { DocumentationCorpus, DocumentationHeading, DocumentationPage } from 'portta-core'
import { markdownParser, parseDocumentation, resolveDocPath } from 'portta-core/documentation-compile'

export type DocHeading = DocumentationHeading
export interface DocPage extends DocumentationPage {
  html: string
}
export interface DocSection {
  title: string
  category: string
  audience: 'user' | 'developer'
  sequential: boolean
  pages: Array<{ slug: string; title: string; summary: string }>
}
export interface DocsBundle {
  corpus: DocumentationCorpus
  sections: DocSection[]
  pages: Record<string, DocPage>
  order: string[]
}

export function sourceUrl(source: string, revision: string | null): string {
  return `https://github.com/codions-labs/portta/blob/${revision ?? 'main'}/${source}`
}

export function rewriteLink(
  href: string,
  source: string,
  corpus: DocumentationCorpus,
): { href: string; external: boolean } {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return { href, external: true }
  if (href.startsWith('#') || href.startsWith('/')) return { href, external: false }
  const [path = '', fragment] = href.split('#')
  const [rawPath = '', query] = path.split('?')
  const target = resolveDocPath(source, decodeURIComponent(rawPath))
  const suffix = `${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`
  if (target === 'docs/README.md') return { href: `/docs${suffix}`, external: false }
  const page = corpus.pages.find((page) => page.source === target || page.source === `${target}/README.md`)
  if (page) return { href: `${page.url}${suffix}`, external: false }
  return { href: `${sourceUrl(target, corpus.identity.revision)}${suffix}`, external: true }
}

const safeTags = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'a',
  'img',
  'br',
  'sub',
  'sup',
  'b',
  'strong',
  'em',
  'i',
])
const safeAttrs = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan'])
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function imageUrl(src: string, source: string): string {
  const target = resolveDocPath(source, src)
  if (!target.startsWith('docs/images/')) throw new Error(`image outside bundled assets: ${source}: ${src}`)
  return `/docs/images/${target.slice('docs/images/'.length)}`
}
/** Raw HTML is limited to the repository's tables; attributes are reconstructed. */
export function rewriteHtmlBlock(html: string, source: string, corpus: DocumentationCorpus): string {
  let invalid = false
  const output = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tag, rawName: string, raw: string) => {
    const name = rawName.toLowerCase()
    if (!safeTags.has(name)) {
      invalid = true
      return ''
    }
    if (tag.startsWith('</')) return `</${name}>`
    const attrs: string[] = []
    const pattern = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
    let consumed = ''
    for (const match of raw.matchAll(pattern)) {
      consumed += match[0]
      const key = match[1]!.toLowerCase()
      let value = match[2] ?? match[3] ?? match[4] ?? ''
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what an attribute value must not carry
      if (!safeAttrs.has(key) || /&|[\u0000-\u001f]/.test(value) || /^\s*(javascript|data|vbscript):/i.test(value)) {
        invalid = true
        continue
      }
      if (key === 'href') value = rewriteLink(value, source, corpus).href
      if (key === 'src') value = imageUrl(value, source)
      attrs.push(`${key}="${escapeHtml(value)}"`)
    }
    if (raw.replace(pattern, '').replace(/[\s/]/g, '') || (!consumed && raw.trim() && raw.trim() !== '/'))
      invalid = true
    if (name === 'a') attrs.push('rel="noreferrer"')
    return `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`
  })
  return invalid ? escapeHtml(html) : output
}

export function renderDocumentation(corpus: DocumentationCorpus): DocsBundle {
  const md = markdownParser()
  const pages: Record<string, DocPage> = {}
  for (const page of corpus.pages) {
    if (page.kind !== 'markdown') continue
    const { tokens } = parseDocumentation(page.markdown)
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!
      // The page chrome owns the one visible H1. Keep its anchor on that heading.
      if (token.type === 'heading_open' && token.tag === 'h1') {
        tokens.splice(index, 3)
        index--
        continue
      }
      if (token.type === 'blockquote_open') {
        const inline = tokens[index + 2]
        const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(inline?.content ?? '')
        if (match && inline) {
          token.attrSet('class', `docs-alert docs-alert-${match[1]!.toLowerCase()}`)
          inline.content = `${match[1]}: ${inline.content.slice(match[0].length)}`
          inline.children = md.parseInline(inline.content, {})[0]?.children ?? null
        }
      }
      for (const child of token.children ?? []) {
        if (child.type === 'link_open') {
          const link = rewriteLink(child.attrGet('href') ?? '', page.source, corpus)
          child.attrSet('href', link.href)
          if (link.external) {
            child.attrSet('rel', 'noreferrer')
            child.attrSet('data-external', 'true')
          }
        }
        if (child.type === 'image') {
          child.attrSet('src', imageUrl(child.attrGet('src') ?? '', page.source))
          child.attrSet('loading', 'lazy')
        }
        if (child.type === 'html_inline') child.content = rewriteHtmlBlock(child.content, page.source, corpus)
      }
      if (token.type === 'html_block') token.content = rewriteHtmlBlock(token.content, page.source, corpus)
    }
    pages[page.slug] = { ...page, html: md.renderer.render(tokens, md.options, {}), headings: page.headings }
  }
  return {
    corpus,
    pages,
    order: corpus.pages.map((page) => page.slug),
    sections: corpus.groups.map((group) => ({
      ...group,
      pages: group.slugs.map((slug) => {
        const page = corpus.pages.find((page) => page.slug === slug)!
        return { slug, title: page.title, summary: page.description }
      }),
    })),
  }
}
