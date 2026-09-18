'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import type { ContainerSummary, Share } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { keys, useShares } from '../lib/queries/index.ts'
import { useFormat } from '../lib/use-format.ts'
import { AddressLine, Mono } from './copy.tsx'
import { Callout } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Select } from './ui/field.tsx'

export function SharePanel({ container }: { container: ContainerSummary }) {
  const { t } = useTranslation('common', { keyPrefix: 'share' })
  const queryClient = useQueryClient()
  const [password, setPassword] = useState<string | null>(null)
  const [ttl, setTtl] = useState(4 * 3600)

  const query = useShares()
  const share = query.data?.shares.find((entry) => entry.container === container.name) ?? null

  const ttls = [
    { label: t('ttl1h'), seconds: 3600 },
    { label: t('ttl4h'), seconds: 4 * 3600 },
    { label: t('ttl24h'), seconds: 24 * 3600 },
  ]

  const done = () => {
    setPassword(null)
    void queryClient.invalidateQueries({ queryKey: keys.shares() })
    void queryClient.invalidateQueries({ queryKey: keys.status() })
  }

  const create = useMutation({
    mutationFn: (mode: 'public' | 'protected') => api.createShare(container.id, { mode, ttlSeconds: ttl }),
    onSuccess: (result) => {
      setPassword(result.password)
      void queryClient.invalidateQueries({ queryKey: keys.shares() })
      void queryClient.invalidateQueries({ queryKey: keys.status() })
    },
  })
  const regenerate = useMutation({
    mutationFn: (id: string) => api.regenerateShare(id),
    onSuccess: (result) => {
      setPassword(result.password)
      void queryClient.invalidateQueries({ queryKey: keys.shares() })
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeShare(id), onSuccess: done })

  const error = create.error ?? regenerate.error ?? revoke.error

  return (
    <div className="space-y-2 text-xs">
      {share ? (
        <ActiveShare
          share={share}
          onRevoke={() => revoke.mutate(share.id)}
          onRegenerate={() => regenerate.mutate(share.id)}
          busy={revoke.isPending || regenerate.isPending}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t('private')}</Badge>
          <span className="text-subtle">{t('privateHint')}</span>
          <Select
            size="sm"
            className="w-28"
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
            aria-label={t('expiresAfter')}
          >
            {ttls.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate('protected')}>
            <Share2 />
            {t('shareWithPassword')}
          </Button>
          {query.data?.publicAllowed ? (
            <Button size="sm" disabled={create.isPending} onClick={() => create.mutate('public')}>
              {t('sharePublicly')}
            </Button>
          ) : null}
        </div>
      )}

      {password ? (
        <Callout
          tone="warn"
          title={
            <>
              {t('passwordLabel')}{' '}
              <Mono kind="text" tone="ink">
                {password}
              </Mono>
            </>
          }
        >
          {t('passwordHint')}
        </Callout>
      ) : null}

      {error ? (
        <div className="text-danger">
          {error.message}
          {'hint' in error && error.hint ? <div className="text-subtle">{String(error.hint)}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function ActiveShare({
  share,
  onRevoke,
  onRegenerate,
  busy,
}: {
  share: Share
  onRevoke: () => void
  onRegenerate: () => void
  busy: boolean
}) {
  const { t } = useTranslation('common', { keyPrefix: 'share' })
  const { expiresIn } = useFormat()

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={share.mode === 'public' ? 'danger' : 'warn'}>{share.mode}</Badge>
        {share.user ? <Mono kind="text">{share.user}</Mono> : null}
        <Badge tone={share.state === 'active' ? 'outline' : 'danger'}>
          {share.state === 'expired'
            ? t('expired')
            : share.state === 'dangling'
              ? t('targetGone')
              : t('expiresIn', { time: expiresIn(share.expiresAt) })}
        </Badge>
      </div>
      <AddressLine value={share.url} href={share.url} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onRevoke}>
          {t('revoke')}
        </Button>
        {share.mode === 'protected' ? (
          <Button size="sm" disabled={busy} onClick={onRegenerate}>
            {t('regeneratePassword')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
