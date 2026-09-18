import { describe, expect, it } from 'vitest'
import { documentationNavigation, getDocumentationPage, searchDocumentation } from './documentation.ts'
import { compileDocumentation, headingId, validateDocumentation } from './documentation-compile.ts'

const source = 'docs/product/guides/domains.md'
const identity = { version: '1', revision: null, hash: 'test' }
const manifest = {
  groups: [
    {
      title: 'Guides',
      category: 'Networking',
      audience: 'user',
      pages: [{ slug: 'domains', source, description: 'Configure a custom hostname.' }],
    },
  ],
}
const markdown =
  '# Domains\n\nConfigure routing.\n\n## DNS\n\nPoint the record at your host.\n\n### Certificates\n\nUse TLS.\n\n## DNS\n\nSecond section.\n'
const corpus = () => compileDocumentation(manifest, { [source]: markdown }, identity)

describe('documentation compilation', () => {
  it('keeps stable routes independent of source paths and titles', () => {
    const docs = corpus()
    expect(docs.pages[0]?.url).toBe('/docs/domains')
    expect(docs.pages[0]?.title).toBe('Domains')
    expect(docs.pages[0]?.headings.map((heading) => heading.id)).toEqual(['domains', 'dns', 'certificates', 'dns-1'])
    expect(headingId('DNS & TLS')).toBe('dns--tls')
    expect(headingId('Configuração local')).toBe('configuração-local')
  })
  it('refuses missing metadata, duplicates, internal sources and orphans', () => {
    expect(() =>
      compileDocumentation(manifest, { [source]: markdown, 'docs/product/orphan.md': '# Orphan' }, identity),
    ).toThrow('unclassified')
    expect(() =>
      compileDocumentation({ groups: [...manifest.groups, ...manifest.groups] }, { [source]: markdown }, identity),
    ).toThrow('duplicate')
    expect(() => compileDocumentation(manifest, { [source]: 'no title' }, identity)).toThrow('H1')
    expect(() => compileDocumentation(manifest, { [source]: '# One\n\n# Two' }, identity)).toThrow('H1')
    const change = (extra: object) => ({
      groups: [{ ...manifest.groups[0], pages: [{ ...manifest.groups[0]!.pages[0], ...extra }] }],
    })
    expect(() => compileDocumentation(change({ description: '' }), { [source]: markdown }, identity)).toThrow()
    expect(() => compileDocumentation(change({ source: 'docs/research/private.md' }), {}, identity)).toThrow(
      'internal source',
    )
    expect(() => compileDocumentation(change({ slug: 'images' }), { [source]: markdown }, identity)).toThrow('reserved')
  })
  it('refuses broken links, anchors, raw HTML assets and external images', () => {
    const validate = (content: string) =>
      validateDocumentation(compileDocumentation(manifest, { [source]: markdown + content }, identity), [source])
    expect(() => validate('[DNS](#dns)')).not.toThrow()
    expect(() => validate('[missing](#missing)')).toThrow('missing anchor')
    expect(() => validate('[missing](other.md)')).toThrow('missing target')
    expect(() => validate('<img src="../../images/no.png">')).toThrow('image')
    expect(() => validate('![remote](https://example.org/image.png)')).toThrow('remote image')
  })
})
describe('documentation queries', () => {
  it('returns exactly a heading subtree, including nested headings', () => {
    const page = getDocumentationPage(corpus(), 'domains', 'dns')!
    expect(page.markdown).toContain('### Certificates')
    expect(page.markdown).not.toContain('Second section')
    expect(page.markdown).not.toContain('# Domains')
    expect(page.url).toBe('/docs/domains#dns')
    expect(getDocumentationPage(corpus(), 'domains', 'absent')).toBeUndefined()
    expect(getDocumentationPage(corpus(), '../private')).toBeUndefined()
  })
  it('searches headings, descriptions and body, with exact title ranked first', () => {
    const page = corpus().pages[0]!
    const pages = [{ ...page, slug: 'other', title: 'Other', text: 'Domains' }, page]
    expect(searchDocumentation(pages, 'domains')[0]?.slug).toBe('domains')
    expect(
      searchDocumentation(
        [
          { ...page, slug: 'vpn', title: 'Configure persistent services' },
          { ...page, slug: 'persistence', title: 'Persistence' },
        ],
        'persist',
      )[0]?.slug,
    ).toBe('persistence')
    expect(searchDocumentation(pages, 'certificates')[0]?.anchor).toBe('certificates')
    expect(searchDocumentation(pages, 'custom hostname')).toHaveLength(2)
    expect(searchDocumentation(pages, 'record')[0]?.excerpt).toContain('record')
    expect(searchDocumentation(pages, 'no match')).toEqual([])
    expect(searchDocumentation(pages, '')).toEqual([])
  })
  it('filters audiences and limits results; metadata does not include bodies', () => {
    const page = corpus().pages[0]!
    expect(
      searchDocumentation([{ ...page, audience: 'developer' }, page], 'domains', { audience: 'user', limit: 1 }),
    ).toHaveLength(1)
    expect(searchDocumentation([page], 'domains', { audience: 'developer' })).toEqual([])
    expect(documentationNavigation(corpus()).pages[0]).not.toHaveProperty('markdown')
  })
})
