'use client'

import { MessageSquareWarning, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'

export function agentIconVisible(status: string, unread: boolean): boolean {
  return status === 'working' || status === 'waiting' || status === 'error' || (status === 'done' && unread)
}

interface AgentStatusIconProps {
  status: string
  size?: number
  pill?: boolean
  unread?: boolean
}

function pillClass(status: string): string {
  if (status === 'working') return 'bg-ok/12 text-ok'
  if (status === 'waiting') return 'bg-warn/14 text-warn'
  if (status === 'done') return 'bg-ok/12 text-ok'
  if (status === 'error') return 'bg-danger/12 text-danger'
  return 'bg-surface-3 text-muted'
}

function StatusMark({ status, size, unread }: { status: string; size: number; unread: boolean }) {
  if (status === 'working') {
    // Three dots that breathe: lucide has no animated glyph for "working".
    return (
      <svg
        aria-hidden="true"
        className="working-dots text-ok"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="none"
      >
        <circle cx="3" cy="12" r="2.5" />
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="21" cy="12" r="2.5" />
      </svg>
    )
  }

  if (status === 'waiting') return <MessageSquareWarning aria-hidden className="text-warn" size={size} />

  if (status === 'done' && unread) {
    return (
      <span aria-hidden className="inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="size-1/2 rounded-full bg-accent" />
      </span>
    )
  }

  if (status === 'error') return <X aria-hidden className="text-danger" size={size} strokeWidth={3} />

  return null
}

export function AgentStatusIcon({ status, size = 10, pill = false, unread = false }: AgentStatusIconProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'agentStatus' })
  const mark = <StatusMark status={status} size={size} unread={unread} />
  if (!pill) return mark

  return (
    <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', pillClass(status))}>
      {mark}
      {status ? t(status, { defaultValue: status }) : t('idle')}
    </span>
  )
}
