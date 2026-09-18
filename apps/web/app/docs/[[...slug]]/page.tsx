import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { DocsBreadcrumbs } from '@/components/docs/breadcrumbs'
import { DocsToc } from '@/components/docs/docs-shell'
import { Prose } from '@/components/docs/prose'
import { docsBundle } from '@/lib/docs/bundle'
import { sourceUrl } from '@/lib/docs/collect'

export const dynamic = 'force-static'
export const dynamicParams = false
interface Params {
  slug?: string[]
}

export function generateStaticParams(): Params[] {
  const { corpus } = docsBundle()
  return [
    { slug: [] },
    { slug: ['overview'] },
    ...corpus.pages.filter((page) => page.kind === 'markdown').map((page) => ({ slug: page.slug.split('/') })),
    ...Object.keys(corpus.aliases).map((slug) => ({ slug: slug.split('/') })),
  ]
}
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const slug = (await params).slug?.join('/')
  const { corpus } = docsBundle()
  const page = corpus.pages.find((page) => page.slug === (corpus.aliases[slug ?? ''] ?? slug))
  return {
    title: page ? `${page.title} · Documentation` : 'Documentation',
    description: page?.description ?? 'Install, operate and develop Portta. Documentation for this installed version.',
  }
}
function DocsHome() {
  const { corpus } = docsBundle()
  const groups = [
    {
      title: 'Get started',
      description: 'From installation to your first running project.',
      slugs: corpus.groups.find((group) => group.sequential)!.slugs,
    },
    {
      title: 'Common tasks',
      description: 'Choose the guide for what you need to do.',
      slugs: [
        'projects',
        'dns-and-tls',
        'remote-development',
        'authentication',
        'database-access',
        'issues',
        'troubleshooting',
      ],
    },
    {
      title: 'Reference',
      description: 'Look up commands, settings and contracts.',
      slugs: ['configuration', 'cli', 'api', 'mcp', 'compatibility'],
    },
    {
      title: 'Understand Portta',
      description: 'Learn the concepts behind your installation.',
      slugs: ['architecture', 'project-model', 'networking', 'persistence', 'security'],
    },
    {
      title: 'Develop Portta',
      description: 'Set up a checkout and find contribution conventions.',
      slugs: ['development-setup', 'monorepo', 'testing', 'documentation', 'adr'],
    },
  ]
  return (
    <article className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight">Portta documentation</h1>
      <p className="mt-3 max-w-prose text-muted">
        Install and operate Portta, understand its concepts, or contribute to its development. This documentation ships
        with Portta {corpus.identity.version}.
      </p>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="mt-1 text-sm text-muted">{group.description}</p>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {group.slugs.map((slug) => {
                // Named rather than asserted. These slugs are a hand-written index into
                // a corpus that is generated, so renaming a page silently breaks one —
                // and `find(...)!` turned that into "Cannot read properties of
                // undefined" during a production prerender, with nothing saying which
                // page. Failing with the slug is the difference between a minute and an
                // afternoon.
                const page = corpus.pages.find((page) => page.slug === slug)
                if (!page) throw new Error(`the documentation index names '${slug}', which is not in the corpus`)
                return (
                  <li key={slug}>
                    <Link href={page.url} className="block rounded px-4 py-3 focus-ring hover:bg-surface-2">
                      <span className="block text-sm font-medium text-accent">{page.title}</span>
                      <span className="mt-1 block text-sm text-muted">{page.description}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </article>
  )
}
export default async function DocPage({ params }: { params: Promise<Params> }) {
  const slug = (await params).slug?.join('/')
  if (!slug) return <DocsHome />
  if (slug === 'overview') permanentRedirect('/docs')
  const { pages, corpus } = docsBundle()
  if (corpus.aliases[slug]) permanentRedirect(`/docs/${corpus.aliases[slug]}`)
  const page = pages[slug]
  if (!page) notFound()
  const sequence = corpus.groups.find((group) => group.sequential && group.slugs.includes(slug))
  const position = sequence?.slugs.indexOf(slug) ?? -1
  const previous = sequence && position > 0 ? pages[sequence.slugs[position - 1]!] : undefined
  const next = sequence ? pages[sequence.slugs[position + 1] ?? ''] : undefined
  return (
    <article className="mx-auto grid max-w-6xl items-start gap-x-10 xl:grid-cols-[minmax(0,75ch)_14rem]">
      <header className="mx-auto mb-6 w-full max-w-[75ch] xl:col-start-1 xl:row-start-1">
        <DocsBreadcrumbs section={page.section} category={page.category} title={page.title} />
        <h1
          id={page.headings.find((heading) => heading.level === 1)?.id}
          className="text-3xl font-semibold tracking-tight"
        >
          {page.title}
        </h1>
      </header>
      <DocsToc headings={page.headings} />
      <div className="mx-auto w-full min-w-0 max-w-[75ch] xl:col-start-1 xl:row-start-2">
        <Prose html={page.html} slug={slug} />
        <footer className="mt-12 border-t border-line pt-6 text-sm">
          {sequence && (
            <nav aria-label="Tutorial sequence" className="grid gap-3 sm:grid-cols-2">
              {previous ? (
                <Link
                  href={previous.url}
                  className="rounded-lg border border-line px-4 py-3 hover:text-accent focus-ring"
                >
                  <span className="block text-xs text-muted">Previous</span>
                  {previous.title}
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={next.url}
                  className="rounded-lg border border-line px-4 py-3 text-right hover:text-accent focus-ring"
                >
                  <span className="block text-xs text-muted">Next</span>
                  {next.title}
                </Link>
              )}
            </nav>
          )}
          <p className="mt-5 text-xs text-muted">
            Portta {corpus.identity.version} · Bundled documentation.{' '}
            <a
              className="rounded underline focus-ring"
              href={sourceUrl(page.source, corpus.identity.revision)}
              target="_blank"
              rel="noreferrer"
            >
              View source on GitHub{corpus.identity.revision ? '' : ' (development branch)'}
            </a>
          </p>
        </footer>
      </div>
    </article>
  )
}
