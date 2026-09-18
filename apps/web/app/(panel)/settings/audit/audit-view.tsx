'use client'

// Who did what, newest first.
//
// The sensitive writes only: accounts, roles, tokens, project membership,
// settings. Issues, sessions and commits are development activity and live on
// the Activity page — mixing them would bury the ten entries that matter under
// a thousand that do not.

import { ScrollText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Empty, ErrorBox, Loading, PageHeader, ToolbarSelect, ViewToolbar } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useCan } from '@/lib/permissions'
import { useAudit, useUsers } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

export function AuditView() {
  const { t } = useTranslation('settings')
  const { relativeTime } = useFormat()
  const [user, setUser] = useState('')
  const [before, setBefore] = useState<string | undefined>(undefined)
  const mayListUsers = useCan('user:list')
  const users = useUsers(mayListUsers)
  const query = useAudit({ ...(user ? { user } : {}), ...(before ? { before } : {}) })

  const page = query.data
  const entries = page?.entries ?? []

  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      {mayListUsers ? (
        <ViewToolbar>
          <ToolbarSelect
            width="lg"
            aria-label={t('audit.filterByUser')}
            value={user}
            onChange={(event) => {
              setUser(event.currentTarget.value)
              setBefore(undefined)
            }}
          >
            <option value="">{t('audit.everybody')}</option>
            {(users.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </ToolbarSelect>
        </ViewToolbar>
      ) : null}

      {query.error ? (
        <div className="mb-4">
          <ErrorBox error={query.error} />
        </div>
      ) : null}

      <Card>
        {query.isPending ? (
          <Loading />
        ) : entries.length === 0 ? (
          <Empty icon={ScrollText} title={t('audit.empty')} hint={t('audit.emptyHint')} />
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>{t('audit.when')}</Th>
                <Th>{t('audit.who')}</Th>
                <Th>{t('audit.action')}</Th>
                <Th>{t('audit.resource')}</Th>
                <Th>{t('audit.where')}</Th>
              </Tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="text-xs whitespace-nowrap text-subtle">{relativeTime(entry.at)}</Td>
                  <Td>
                    <div className="text-sm text-ink">{entry.userEmail ?? entry.actor}</div>
                    <div className="text-2xs text-subtle">
                      <Badge tone={entry.principalKind === 'token' ? 'agent' : 'neutral'}>
                        {t(`audit.kind.${entry.principalKind}`)}
                      </Badge>
                    </div>
                  </Td>
                  <Td>
                    <Mono kind="text" tone="ink" className="text-xs">
                      {entry.action}
                    </Mono>
                  </Td>
                  <Td className="text-xs text-muted">
                    {entry.resourceName ?? entry.resourceId ?? '—'}
                    <span className="ml-1 text-2xs text-subtle">{entry.resourceType}</span>
                  </Td>
                  <Td className="text-xs text-subtle">
                    {entry.project ?? '—'}
                    {entry.ipAddress ? <span className="ml-1 text-2xs">{entry.ipAddress}</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {page?.nextBefore ? (
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setBefore(page.nextBefore ?? undefined)}>
            {t('audit.older')}
          </Button>
        </div>
      ) : null}
    </>
  )
}
