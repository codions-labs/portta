import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileDocumentation, validateDocumentation } from 'portta-core/documentation-compile'
import { describe, expect, it } from 'vitest'
import { renderDocumentation, rewriteHtmlBlock, rewriteLink } from '@/lib/docs/collect'

const root = new URL('../../../../', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/navigation.json'), 'utf8'))
const sources: Record<string, string> = {}
for (const directory of ['docs/product', 'docs/development']) {
  for (const file of readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.md'),
  ))
    sources[`${directory}/${file}`] = readFileSync(resolve(root, directory, file), 'utf8')
}
sources['CHANGELOG.md'] = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
const corpus = compileDocumentation(manifest, sources, { version: 'test', revision: null, hash: 'test' })
const bundle = renderDocumentation(corpus)

describe('the published documentation', () => {
  it('classifies every page exactly once and excludes repository-only sources', () => {
    expect(new Set(bundle.order).size).toBe(corpus.pages.length)
    expect(bundle.sections.some((section) => section.title === 'Everything else')).toBe(false)
    expect(corpus.pages.some((page) => /research|agent-guidelines|configuration-audit/.test(page.source))).toBe(false)
    expect(corpus.groups.filter((group) => group.sequential).flatMap((group) => group.slugs)).toEqual([
      'install',
      'first-environment',
      'first-project',
    ])
  })
  // The documentation index in `app/docs/[[...slug]]/page.tsx` is a hand-written
  // list of slugs into a corpus that is generated, so renaming a page breaks it
  // — and it breaks during the production prerender, which no suite ran.
  // Renaming `tasks` to `issues` did exactly that: `next build` failed with
  // "Cannot read properties of undefined (reading 'url')" and nothing said why.
  it('names only slugs the corpus has, on the front page', () => {
    const page = readFileSync(resolve(root, 'apps/web/app/docs/[[...slug]]/page.tsx'), 'utf8')
    const slugs = [...page.matchAll(/slugs:\s*\[([^\]]+)\]/g)].flatMap((match) =>
      [...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!),
    )
    expect(slugs.length).toBeGreaterThan(20)
    const have = new Set(corpus.pages.map((entry) => entry.slug))
    expect(slugs.filter((slug) => !have.has(slug))).toEqual([])
  })

  it('uses source mappings for links and leaves internal instructions on GitHub', () => {
    expect(rewriteLink('../concepts/networking.md#ports', 'docs/product/guides/install.md', corpus).href).toBe(
      '/docs/networking#ports',
    )
    expect(rewriteLink('../../README.md', 'docs/product/guides/install.md', corpus).href).toBe('/docs')
    expect(rewriteLink('../agent-guidelines.md', 'docs/development/monorepo.md', corpus)).toEqual({
      href: 'https://github.com/codions-labs/portta/blob/main/docs/agent-guidelines.md',
      external: true,
    })
  })
  it('renders local screenshots and preserves Mermaid source without duplicate H1', () => {
    const html = Object.values(bundle.pages)
      .map((page) => page.html)
      .join('')
    expect(html).toContain('/docs/images/auth-disabled-overview.png')
    expect(html).toContain('language-mermaid')
    expect(html).not.toMatch(/<h1\b|<script\b|<img[^>]+src="https?:/i)
  })
  it('renders GitHub alerts and safe tables without event handlers', () => {
    expect(bundle.pages['backup-restore']?.html).toContain('docs-alert-caution')
    expect(
      rewriteHtmlBlock('<table><tr><td>Data</td></tr></table>', 'docs/product/guides/install.md', corpus),
    ).toContain('<table>')
    for (const html of [
      '<script>alert(1)</script>',
      '<img src="../../images/panel.png" onerror="alert(1)">',
      '<a href="&#106;avascript:alert(1)">x</a>',
    ]) {
      // Invalid HTML is escaped before any browser sees it.
      expect(rewriteHtmlBlock(html, 'docs/product/guides/install.md', corpus)).toContain('&lt;')
    }
  })
  it('validates asset existence during collection rather than in a browser', () => {
    expect(() =>
      validateDocumentation(
        { ...corpus, pages: [{ ...corpus.pages[0]!, markdown: '![absent](../../images/absent.png)' }] },
        [],
      ),
    ).toThrow('image')
  })
})
