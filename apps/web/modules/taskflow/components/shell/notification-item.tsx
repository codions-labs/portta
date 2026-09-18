'use client'

import { CheckCircle2, Info } from 'lucide-react'
import type { AppNotification } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'

interface NotificationItemProps {
  notification: AppNotification
  showTimestamp?: boolean
  large?: boolean
  wrap?: boolean
}

export function NotificationItem({
  notification,
  showTimestamp = false,
  large = false,
  wrap = false,
}: NotificationItemProps) {
  const completed = notification.type === 'agent_stopped' || notification.type === 'worktree_auto_removed'
  const Icon = completed ? CheckCircle2 : Info

  return (
    <>
      <Icon
        aria-hidden
        className={cn('mt-0.5 shrink-0', large ? 'size-4' : 'size-3.5', completed ? 'text-ok' : 'text-accent')}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(large ? 'text-sm' : 'text-xs', 'text-ink', wrap ? 'break-words whitespace-normal' : 'truncate')}
        >
          {notification.message}
        </span>
        {showTimestamp ? (
          <span className="text-2xs text-subtle">{new Date(notification.timestamp).toLocaleTimeString()}</span>
        ) : notification.url ? (
          <span className={cn('text-xs text-accent', wrap ? 'break-all whitespace-normal' : 'truncate')}>
            {notification.url}
          </span>
        ) : null}
      </span>
    </>
  )
}
