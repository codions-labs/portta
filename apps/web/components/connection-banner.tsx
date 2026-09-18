'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LiveState } from '../lib/live.ts'
import { toneBorder, toneText, toneWash } from '../lib/tone.ts'
import { cn } from '../lib/utils.ts'

const CONNECTING_DELAY_MS = 2_000

function useShowConnectionBanner(state: LiveState): boolean {
  const [showConnecting, setShowConnecting] = useState(false)

  useEffect(() => {
    if (state !== 'connecting') {
      setShowConnecting(false)
      return
    }
    const timer = setTimeout(() => setShowConnecting(true), CONNECTING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state])

  if (state === 'offline') return true
  if (state === 'connecting') return showConnecting
  return false
}

export function ConnectionBanner({ state }: { state: LiveState }) {
  const { t } = useTranslation('nav')
  const visible = useShowConnectionBanner(state)
  if (!visible) return null

  const tone = state === 'connecting' ? 'warn' : 'danger'

  return (
    <div
      role="status"
      className={cn(
        'shrink-0 border-b px-4 py-1 text-center text-xs font-medium',
        toneBorder[tone],
        toneWash[tone],
        toneText[tone],
      )}
    >
      {state === 'connecting' ? t('connection.reconnecting') : t('connection.offline')}
    </div>
  )
}
