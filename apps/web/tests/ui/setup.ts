import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
// The primitives name their controls through i18n, so a test that renders one
// alone still gets English names. The panel initialises i18next from the locale
// the server decided; a test has no server, so it says English here.
import { initI18n } from '@/lib/i18n/client'

initI18n('en')

// jsdom has neither of these, and the panel touches both on mount.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(handler)
    this.listeners.set(type, set)
  }

  emit(type: string, data: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(new MessageEvent(type, { data: JSON.stringify(data) }))
    }
  }

  close() {}
}

vi.stubGlobal('EventSource', FakeEventSource)

/**
 * Next's router, as far as a component test is concerned.
 *
 * A page under test navigates, reads the path and reads the query string. None
 * of those exist outside a Next render, and mocking them per file would be the
 * same twelve lines in every one. `navigation.push` is exported so a test can
 * assert where a click went.
 */
export const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  pathname: '/',
  search: '',
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
    refresh: navigation.refresh,
    back: navigation.back,
    prefetch: () => undefined,
  }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  redirect: (href: string) => {
    navigation.push(href)
  },
  notFound: () => {
    throw new Error('notFound')
  },
  // ThemeProvider uses this to put the pre-paint script in <head>. A component
  // test has no Next document, so the callback is a no-op.
  useServerInsertedHTML: () => {},
}))

if (!window.matchMedia) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
})

// Radix measures elements Vitest's jsdom cannot lay out.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {}
}

export { FakeEventSource }
