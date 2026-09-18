import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { DocsShell } from '@/components/docs/docs-shell'
import { docsBundle } from '@/lib/docs/bundle'
import { hasDeps, serverDeps } from '@/lib/server/deps'

/**
 * The documentation site the panel serves.
 *
 * Offline by construction: the corpus is the repository's own Markdown, read
 * and rendered on the server, so there is no CDN, no font host, no telemetry
 * and no runtime Markdown dependency in the browser. The API reference is the
 * one page that talks to anything, and it talks only to this panel.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  // The guides are static text with no host information in them, so a routed
  // panel may serve them — but an operator who turned them off means it.
  //
  // `hasDeps` because these pages are also rendered at build time, where there
  // is no panel to ask: the build produces them, and the running panel decides
  // whether to serve them.
  if (hasDeps() && !serverDeps().config.docs) notFound()

  const { sections, corpus } = docsBundle()
  return (
    <DocsShell
      sections={sections}
      version={corpus.identity.version}
      searchPages={corpus.pages.map((page) => ({ ...page, markdown: '' }))}
    >
      {children}
    </DocsShell>
  )
}
