'use client'

// Where you are signed in.
//
// Better Auth's own listing, because these are your sessions and the library's
// endpoint is the one that knows which of them is the browser you are reading
// this in. Ending that one signs you out, so it is not offered as a row action.

import { MonitorSmartphone } from 'lucide-react'
import type { UserSession } from 'portta-contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Callout, Empty, SkeletonRows } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { useFormat } from '@/lib/use-format'
import { SessionRows } from './session-rows'

interface Row extends UserSession {
  token: string
  current: boolean
}

const seconds = (value: string | Date): number => Math.floor(new Date(value).getTime() / 1000)

export function MySessionsCard() {
  const { t } = useTranslation('settings')
  const { relativeTime } = useFormat()
  const { data: session } = authClient.useSession()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data, error: refused } = await authClient.listSessions()
    if (refused) return setError(refused.message ?? t('security.sessionsRefused'))
    setError(null)
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        token: row.token,
        current: row.token === session?.session.token,
        createdAt: seconds(row.createdAt),
        expiresAt: seconds(row.expiresAt),
        ipAddress: row.ipAddress ?? null,
        userAgent: row.userAgent ?? null,
      })),
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list reloads when the session token arrives; load is a plain function of this render
  useEffect(() => {
    void load()
    // The current session's token is what marks a row as "this browser"; until
    // it arrives the list is still worth showing, unmarked.
  }, [session?.session.token])

  async function revoke(token: string) {
    setBusy(true)
    const { error: refused } = await authClient.revokeSession({ token })
    setBusy(false)
    if (refused) return setError(refused.message ?? t('security.sessionsRefused'))
    await load()
  }

  return (
    <Card>
      <CardHeader
        title={t('security.sessions')}
        description={t('security.sessionsDescription')}
        icon={<MonitorSmartphone />}
      />
      <CardBody>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {rows === null ? <SkeletonRows rows={2} /> : null}
        {rows?.length === 0 ? <Empty title={t('security.noSessions')} compact /> : null}
        {rows && rows.length > 0 ? (
          <SessionRows
            sessions={rows}
            relativeTime={relativeTime}
            action={(row) => {
              const here = rows.find((candidate) => candidate.id === row.id)?.current ?? false
              return here ? (
                <span className="text-2xs text-ok">{t('security.thisBrowser')}</span>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => revoke(rows.find((candidate) => candidate.id === row.id)?.token ?? '')}
                >
                  {t('security.signOut')}
                </Button>
              )
            }}
          />
        ) : null}
      </CardBody>
    </Card>
  )
}
