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
  const { t } = useTranslation('diagnostics')
  const id = diagnostic.id
  const params = { ...diagnostic.params, defaultValue: diagnostic[part] }

  // Try status-specific key first (e.g. diagnostics.docker.fail.detail)
  const statusKey = `${id}.${diagnostic.status}.${part}`
  const flatKey = `${id}.${part}`

  const fromStatus = t(statusKey, params)
  if (fromStatus !== statusKey) {
    return (
      <div className={className}>
        <DocText>{fromStatus}</DocText>
      </div>
    )
  }

  const fromFlat = t(flatKey, params)
  if (fromFlat !== flatKey) {
    return (
      <div className={className}>
        <DocText>{fromFlat}</DocText>
      </div>
    )
  }

  // Nested pass/warn/fail structure
  const nested = t(`${id}.${part}`, params)
  if (nested !== `${id}.${part}`) {
    return (
      <div className={className}>
        <DocText>{nested}</DocText>
      </div>
    )
  }

  return (
    <div className={className}>
      <DocText>{diagnostic[part]}</DocText>
    </div>
  )
}
