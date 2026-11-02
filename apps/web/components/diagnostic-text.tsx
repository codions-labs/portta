'use client'

import type { Diagnostic } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { DocText } from './doc-text.tsx'

export function DiagnosticText({
  diagnostic,
  part,
  className,
}: {
  diagnostic: Diagnostic
  part: 'title' | 'detail' | 'fix'
  className?: string
}) {
  const { t, i18n } = useTranslation('diagnostics')
  const key = [`${diagnostic.id}.${diagnostic.status}.${part}`, `${diagnostic.id}.${part}`].find((candidate) =>
    i18n.exists(candidate, { ns: 'diagnostics' }),
  )
  const translated = key ? (t(key as never, (diagnostic.params ?? {}) as never) as unknown as string) : null
  // Not every check sends the values its sentence needs, and its own wording is
  // better than a placeholder on the screen.
  const text = translated && !translated.includes('{{') ? translated : diagnostic[part]

  return (
    <div className={className}>
      <DocText>{text}</DocText>
    </div>
  )
}
