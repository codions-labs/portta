'use client'

// The browsers an account is signed in on, and the way to end all of them.
//
// One at a time is not offered: a session id is not something anybody can
// recognise, so the useful action is "sign this account out everywhere", which
// is also what somebody reaches for when a laptop is lost.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { User } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Empty, ErrorBox, SkeletonRows } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useUserSessions } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { SessionRows } from './session-rows'

export function UserSessionsDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const query = useUserSessions(user.id, open)
  const mayRevoke = useCan('session:revoke')

  const revoke = useMutation({
    mutationFn: () => api.revokeUserSessions(user.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.userSessions(user.id) }),
  })

  const sessions = query.data ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.sessionsFor', { name: user.name })}
      description={t('users.sessionsDescription')}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {tc('close')}
          </Button>
          {mayRevoke ? (
            <Button
              variant="danger"
              size="sm"
              disabled={revoke.isPending || sessions.length === 0}
              onClick={() => revoke.mutate()}
            >
              {t('users.revokeAll')}
            </Button>
          ) : null}
        </>
      }
    >
      {query.isPending ? <SkeletonRows rows={2} /> : null}
      {query.error ? <ErrorBox error={query.error} /> : null}
      {revoke.error ? <ErrorBox error={revoke.error} /> : null}
      {query.data && sessions.length === 0 ? <Empty title={t('users.noSessions')} /> : null}
      {sessions.length > 0 ? <SessionRows sessions={sessions} relativeTime={relativeTime} /> : null}
    </Dialog>
  )
}
