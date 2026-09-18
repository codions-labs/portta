'use client'

import { Menu, Moon, Sun } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type DocsAudience, type DocumentationPage, searchDocumentation } from 'portta-core/browser'
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PorttaBrand } from '@/components/ui/brand'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { DocHeading, DocSection } from '@/lib/docs/collect'
import { useDarkTheme, useThemeChoice } from '@/lib/theme'

const DocsScrollContext = createContext<RefObject<HTMLElement | null>>({ current: null })
export function useDocsScrollRoot() {
  return useContext(DocsScrollContext)
}

export function DocsToc({ headings }: { headings: Array<Pick<DocHeading, 'id' | 'text' | 'level'>> }) {
  const root = useDocsScrollRoot()
  const visible = useMemo(() => headings.filter((heading) => heading.level === 2 || heading.level === 3), [headings])
  const [active, setActive] = useState(visible[0]?.id)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const update = () => setExpanded(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const container = root.current
    if (!container) return
    const update = () => {
      const top = container.getBoundingClientRect().top + 80
      let current = visible[0]?.id
      for (const heading of visible) {
        const element = document.getElementById(heading.id)
        if (element && element.getBoundingClientRect().top <= top) current = heading.id
      }
      setActive(current)
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    return () => container.removeEventListener('scroll', update)
  }, [visible, root])
  if (visible.length < 2) return null
  return (
    <aside className="mb-6 min-w-0 xl:sticky xl:top-0 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:mb-0 xl:max-h-[calc(100dvh-8rem)] xl:w-56 xl:overflow-y-auto">
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        className="rounded-lg border border-line p-3 xl:border-0"
      >
        <summary className="cursor-pointer text-sm font-medium focus-ring">On this page</summary>
        <nav aria-label="On this page" className="mt-3 text-sm">
          <ul className="space-y-2">
            {visible.map((heading) => (
              <li key={heading.id} className={heading.level === 3 ? 'pl-3' : ''}>
                <a
                  href={`#${heading.id}`}
                  aria-current={active === heading.id ? 'location' : undefined}
                  className={`block break-words rounded focus-ring ${active === heading.id ? 'text-accent' : 'text-muted hover:text-ink'}`}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </details>
    </aside>
  )
}

export function DocsShell({
  sections,
  searchPages,
  version,
  children,
}: {
  sections: DocSection[]
  searchPages: DocumentationPage[]
  version: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const slug = pathname.replace(/^\/docs\/?/, '')
  const currentAudience =
    sections.find((section) => section.pages.some((page) => page.slug === slug))?.audience ?? 'user'
  const [audience, setAudience] = useState<DocsAudience>(currentAudience)
  const [allAudiences, setAllAudiences] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeHit, setActiveHit] = useState(-1)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const main = useRef<HTMLElement>(null)
  const dark = useDarkTheme()
  const { setTheme } = useThemeChoice()
  const hits = useMemo(
    () => searchDocumentation(searchPages, query, { audience: allAudiences ? 'all' : audience, limit: 20 }),
    [searchPages, query, audience, allAudiences],
  )
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        input.current?.focus()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: every navigation resets the search and the scroll position
  useEffect(() => {
    setAudience(currentAudience)
    setQuery('')
    setSearchOpen(false)
    setOpen(false)
    const hash = decodeURIComponent(window.location.hash.slice(1))
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }))
    else main.current?.scrollTo({ top: 0 })
  }, [pathname, currentAudience])
  useEffect(() => {
    if (searchOpen && activeHit >= 0)
      document.getElementById(`docs-hit-${activeHit}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeHit, searchOpen])
  const nav = (
    <nav aria-label="Documentation navigation" className="space-y-5">
      <label className="block text-xs font-medium text-muted">
        Documentation for
        <select
          aria-label="Documentation audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value as DocsAudience)}
          className="mt-2 w-full rounded-md border border-line bg-surface p-2 text-sm text-ink focus-ring"
        >
          <option value="user">Users and operators</option>
          <option value="developer">Developers and contributors</option>
        </select>
      </label>
      <Link
        href="/docs"
        aria-current={!slug ? 'page' : undefined}
        className="block rounded px-2 text-sm text-muted focus-ring"
      >
        Documentation home
      </Link>
      {sections
        .filter((section) => section.audience === audience)
        .map((section, index, selected) => {
          const links = (
            <ul className="space-y-0.5">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`/docs/${page.slug}`}
                    title={page.summary}
                    aria-current={slug === page.slug ? 'page' : undefined}
                    className={`block rounded-md px-2 py-1.5 text-sm focus-ring ${slug === page.slug ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
                  >
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          )
          return (
            <div key={`${section.title}/${section.category}`}>
              {selected[index - 1]?.title !== section.title && (
                <p className="mb-2 px-2 text-sm font-semibold">{section.title}</p>
              )}
              {section.category ? (
                <details
                  key={`${pathname}/${section.category}`}
                  open={section.pages.some((page) => page.slug === slug)}
                >
                  <summary className="mb-1 cursor-pointer rounded px-2 text-sm font-medium text-muted focus-ring">
                    {section.category}
                  </summary>
                  {links}
                </details>
              ) : (
                links
              )}
            </div>
          )
        })}
    </nav>
  )
  return (
    <div lang="en" className="docs-root flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink">
      <a href="#docs-main" className="sr-only z-50 rounded bg-surface p-3 focus:not-sr-only focus:absolute focus-ring">
        Skip to documentation content
      </a>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open documentation navigation"
          className="rounded p-2 focus-ring lg:hidden"
        >
          <Menu className="size-4" />
        </button>
        <Link href="/docs" className="flex items-center gap-2 rounded font-semibold focus-ring">
          <PorttaBrand />
          Portta docs
        </Link>
        <span className="hidden text-xs text-subtle md:inline">{version}</span>
        <div
          role="search"
          className="relative order-last w-full sm:order-none sm:ml-auto sm:max-w-md"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false)
          }}
        >
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Search the documentation"
            aria-expanded={searchOpen && !!query.trim()}
            aria-controls={searchOpen && query.trim() ? 'docs-search-results' : undefined}
            aria-keyshortcuts="Control+K Meta+K"
            aria-autocomplete="list"
            aria-activedescendant={
              searchOpen && activeHit >= 0 && hits[activeHit] ? `docs-hit-${activeHit}` : undefined
            }
            value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
              setActiveHit(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchOpen(false)
                setActiveHit(-1)
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setSearchOpen(true)
                setActiveHit((index) =>
                  Math.max(0, Math.min(hits.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))),
                )
              }
              if (event.key === 'Enter' && searchOpen && hits[activeHit]) {
                event.preventDefault()
                router.push(hits[activeHit]!.url)
                setSearchOpen(false)
                input.current?.blur()
              }
            }}
            placeholder="Search documentation…"
            className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus-ring sm:pr-20"
          />
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 hidden text-[10px] text-subtle sm:block"
          >
            Ctrl/⌘ K
          </kbd>
          {searchOpen && query.trim() && (
            <div className="absolute z-30 mt-1 max-h-[65dvh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-lg">
              <label className="mb-2 flex items-center gap-2 px-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={allAudiences}
                  onChange={(event) => {
                    setAllAudiences(event.target.checked)
                    setActiveHit(-1)
                  }}
                />
                Search all audiences
              </label>
              <p role="status" className="px-2 py-1 text-xs text-subtle">
                {hits.length ? `${hits.length} results` : 'No matching documentation.'}
              </p>
              {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an ARIA listbox over a list; the combobox keeps focus and names the active option */}
              <ul id="docs-search-results" role="listbox" aria-label="Documentation search results">
                {hits.map((hit, index) => (
                  // biome-ignore lint/a11y/useFocusableInteractive: reached through aria-activedescendant on the combobox
                  <li
                    key={hit.slug}
                    id={`docs-hit-${index}`}
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an option of the listbox above
                    role="option"
                    aria-selected={activeHit === index}
                    className={activeHit === index ? 'rounded bg-surface-2' : ''}
                  >
                    <Link
                      href={hit.url}
                      onClick={() => setSearchOpen(false)}
                      className="block rounded p-2 focus-ring hover:bg-surface-2"
                    >
                      <span className="block text-sm font-medium">{hit.title}</span>
                      <span className="block text-xs text-accent">
                        {hit.audience === 'developer' ? 'Development' : hit.section}
                        {hit.category ? ` / ${hit.category}` : ''}
                      </span>
                      <span className="mt-1 block text-xs text-muted">{hit.excerpt}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Link href="/" className="ml-auto rounded text-sm text-muted focus-ring sm:ml-0">
          Panel
        </Link>
        <Button
          variant="ghost"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
          aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:block">
          {nav}
        </aside>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuButton.current?.focus()
          }}
          title="Documentation navigation"
        >
          {nav}
        </Dialog>
        <DocsScrollContext.Provider value={main}>
          <main
            id="docs-main"
            tabIndex={-1}
            ref={main}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 outline-none sm:px-8 lg:px-10 lg:py-10"
          >
            {children}
          </main>
        </DocsScrollContext.Provider>
      </div>
    </div>
  )
}
