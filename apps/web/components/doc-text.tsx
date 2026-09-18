'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Overview } from 'portta-contracts'
import { splitDocRefs } from 'portta-contracts'
import type { ReactNode } from 'react'
import { api } from '../lib/api/index.ts'
import { keys } from '../lib/queries/keys.ts'

function useDocsEnabled(): boolean {
  const client = useQueryClient()
  const cached = client.getQueryData<Overview>(['status'])
  const { data } = useQuery({
    queryKey: keys.status(),
    queryFn: () => api.overview(),
    enabled: typeof api.overview === 'function',
    retry: false,
  })
  return (data ?? cached)?.gateway.panel.docs ?? true
}

const SEE_PREFIX = /(?:See|Veja|see|veja)\s+$/

type DocPart = { text: string; href: string | null }

function isMarkdownCitation(text: string): boolean {
  return text.startsWith('docs/') && text.includes('.md')
}

/**
 * Settings copy prefers “Learn more” over the repository path. `/docs` and
 * `/docs/api` stay as written: they are the address served, not a citation.
 */
function labeledParts(parts: DocPart[], citationLabel?: string): DocPart[] {
  if (!citationLabel) return parts
  return parts.flatMap((part, index) => {
    const next = parts[index + 1]
    if (!part.href && next?.href && isMarkdownCitation(next.text)) {
      const trimmed = part.text.replace(SEE_PREFIX, '')
      return trimmed ? [{ ...part, text: trimmed }] : []
    }
    if (part.href && isMarkdownCitation(part.text)) {
      return [{ ...part, text: citationLabel }]
    }
    return [part]
  })
}

/**
 * Turns citations like `docs/product/guides/github.md` and `/docs/api` into deep links to
 * the documentation site. Plain text when the panel does not serve docs.
 */
export function DocText({ children, citationLabel }: { children: string; citationLabel?: string }): ReactNode {
  const enabled = useDocsEnabled()
  if (!enabled) return children
  return labeledParts(splitDocRefs(children), citationLabel).map((part, index) =>
    part.href ? (
      <a
        key={`${part.href}:${index}`}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent"
      >
        {part.text}
      </a>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  )
}
