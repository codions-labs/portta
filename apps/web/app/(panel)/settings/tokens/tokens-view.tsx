'use client'

// The credentials that are not a browser: the CLI on a laptop, an agent in a
// terminal, a job in CI.
//
// A token belongs to the person who made it and can never hold more than their
// role does — the intersection is computed on every request, so demoting
// somebody demotes their tokens in the same moment. Yours need no permission
// beyond `token:*`; everybody's needs `user:list`.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus } from 'lucide-react'
import type { ApiToken } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { CreateTokenDialog } from '@/components/settings/create-token-dialog'
import { Empty, ErrorBox, Loading, PageHeader, ViewToolbar } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Segmented } from '@/components/ui/segmented'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { useApiTokens } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

export function TokensView() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { relativeTime, expiresIn } = useFormat()
  const queryClient = useQueryClient()
  const mayCreate = useCan('token:create')
  const mayRevoke = useCan('token:revoke')
  const maySeeEverybody = useCan('user:list')
  const [all, setAll] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const query = useApiTokens(all && maySeeEverybody)

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiToken(id),
    onSuccess: () => {
      setRevoking(null)
      return queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const tokens = query.data ?? []

  return (
    <>
      <PageHeader
        title={t('tokens.title')}
        description={t('tokens.description')}
        actions={
          mayCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              {t('tokens.create')}
            </Button>
          ) : null
        }
      />

      {maySeeEverybody ? (
        <ViewToolbar
          switcher={
            <Segmented
              label={t('tokens.whose')}
              value={all ? 'all' : 'mine'}
              onChange={(value) => setAll(value === 'all')}
              options={[
                { value: 'mine', label: t('tokens.mine') },
                { value: 'all', label: t('tokens.everybody') },
              ]}
            />
          }
        />
      ) : null}

      {query.error ? (
        <div className="mb-4">
          <ErrorBox error={query.error} />
        </div>
      ) : null}
      {revoke.error ? (
        <div className="mb-4">
          <ErrorBox error={revoke.error} />
        </div>
      ) : null}

      <Card>
        {query.isPending ? (
          <Loading />
        ) : tokens.length === 0 ? (
          <Empty icon={KeyRound} title={t('tokens.empty')} hint={t('tokens.emptyHint')} />
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>{t('tokens.name')}</Th>
                <Th>{t('tokens.prefix')}</Th>
                {all ? <Th>{t('tokens.owner')}</Th> : null}
                <Th>{t('tokens.actor')}</Th>
                <Th>{t('tokens.lastUsed')}</Th>
                <Th>{t('tokens.expires')}</Th>
                <Th className="text-right">{tc('actions')}</Th>
              </Tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <Tr key={token.id}>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink">{token.name}</span>
                      {token.enabled ? null : <Badge tone="danger">{t('tokens.revoked')}</Badge>}
                    </div>
                    <div className="text-2xs text-subtle">{t('tokens.scopeCount', { count: token.scopes.length })}</div>
                  </Td>
                  <Td>
                    <Mono kind="text">{token.start ? `${token.start}…` : '—'}</Mono>
                  </Td>
                  {all ? <Td className="text-xs text-muted">{token.user}</Td> : null}
                  <Td>
                    {/* The actor a token announces is its own name, so saying
                        it here again would be the same word twice. What the
                        column is for is which kind of caller it is. */}
                    <Badge tone={token.actorKind === 'agent' ? 'agent' : 'neutral'}>
                      {token.actorKind === 'agent' ? t('tokens.agent') : t('tokens.human')}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-subtle">
                    {token.lastUsedAt ? relativeTime(token.lastUsedAt) : t('tokens.neverUsed')}
                  </Td>
                  <Td className="text-xs text-subtle">
                    {token.expiresAt ? expiresIn(token.expiresAt) : t('tokens.noExpiry')}
                  </Td>
                  <Td className="text-right">
                    {mayRevoke && token.enabled ? (
                      <Button variant="ghost" size="xs" onClick={() => setRevoking(token)}>
                        {t('tokens.revoke')}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['tokens'] })}
      />

      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={() => setRevoking(null)}
          title={t('tokens.revokeTitle', { name: revoking.name })}
          impact={t('tokens.revokeImpact')}
          confirmLabel={t('tokens.revoke')}
          busy={revoke.isPending}
          error={revoke.error}
          onConfirm={() => revoke.mutate(revoking.id)}
        />
      ) : null}
    </>
  )
}
