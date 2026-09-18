'use client'

// One open session, in the two facts that identify it to the person who owns
// it: where it was opened from, and when. The user agent is the browser's own
// claim and is shown as such, truncated — it is a hint, not evidence.

import type { UserSession } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'

export function SessionRows({
  sessions,
  relativeTime,
  action,
}: {
  sessions: UserSession[]
  relativeTime: (epochSeconds: number | null | undefined) => string
  /** A per-row control, when the caller offers one. */
  action?: (session: UserSession) => React.ReactNode
}) {
  const { t } = useTranslation('settings')
  return (
    <ul className="divide-y divide-line-subtle">
      {sessions.map((session) => (
        <li key={session.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <Mono kind="host" tone="ink" className="text-xs">
                {session.ipAddress ?? t('security.unknownAddress')}
              </Mono>
              <span className="text-2xs text-subtle">
                {t('security.startedAt', { when: relativeTime(session.createdAt) })}
              </span>
            </div>
            <p className="truncate text-2xs text-subtle">{session.userAgent ?? t('security.unknownBrowser')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-2xs text-subtle">
              {t('security.expires', { when: relativeTime(session.expiresAt) })}
            </span>
            {action?.(session)}
          </div>
        </li>
      ))}
    </ul>
  )
}
