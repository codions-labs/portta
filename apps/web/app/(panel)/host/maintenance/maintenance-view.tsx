'use client'

// A real cleanup of the server: the stopped containers, unused networks, images
// and volumes that pile up. It shows what each part would free first, lists
// exactly what would go, and only then asks. Portta's own resources, Docker's
// default networks and anything a container still uses are never swept.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DockerPruneBody, DockerPruneResult } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnnounce } from '@/components/host/docker-resources'
import { Callout, ErrorBox, Loading, StatTile } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Checkbox, Field, Select } from '@/components/ui/field'
import { api } from '@/lib/api'
import { keys, useDockerUsage } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

type Plan = Omit<DockerPruneBody, 'confirm' | 'dryRun'>

const SAFE: Plan = { containers: false, networks: true, images: 'dangling', volumes: 'none' }

export function MaintenanceView() {
  const { t } = useTranslation('cleanup', { keyPrefix: 'maintenance' })
  const { t: tc } = useTranslation('cleanup')
  const { storage } = useFormat()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const usage = useDockerUsage()
  const [plan, setPlan] = useState<Plan>(SAFE)
  const [preview, setPreview] = useState<DockerPruneResult | null>(null)
  const [confirming, setConfirming] = useState(false)

  const change = (next: Partial<Plan>) => {
    setPlan((current) => ({ ...current, ...next }))
    // A list made for other choices says nothing about these.
    setPreview(null)
  }

  const look = useMutation({
    mutationFn: () => api.pruneDocker({ ...plan, dryRun: true }),
    onSuccess: setPreview,
  })
  const sweep = useMutation({
    // Only what the preview listed may go: whatever became removable since is left.
    mutationFn: () =>
      api.pruneDocker({
        ...plan,
        dryRun: false,
        candidates: (preview?.items ?? []).map((item) => `${item.kind}:${item.id}`),
      }),
    onSuccess: (result) => {
      setConfirming(false)
      setPreview(null)
      announce(result, result.items)
      void queryClient.invalidateQueries({ queryKey: keys.docker() })
      void queryClient.invalidateQueries({ queryKey: keys.network() })
    },
  })

  if (usage.isPending) return <Loading />
  if (usage.error) return <ErrorBox error={usage.error} />
  const data = usage.data
  const nothing = !plan.containers && !plan.networks && plan.images === 'none' && plan.volumes === 'none'
  const withVolumes = plan.volumes === 'unused'
  const typed = t('confirm.typed')

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t('stats.containers')}
          value={data?.containers.stopped ?? 0}
          hint={t('stats.containersHint', { total: data?.containers.total ?? 0 })}
        />
        <StatTile
          label={t('stats.networks')}
          value={data?.networks.unused ?? 0}
          hint={t('stats.networksHint', { total: data?.networks.total ?? 0 })}
        />
        <StatTile
          label={t('stats.images')}
          value={storage(data?.images.unusedBytes ?? 0)}
          hint={t('stats.imagesHint', {
            unused: data?.images.unused ?? 0,
            dangling: data?.images.dangling ?? 0,
            total: storage(data?.images.totalBytes ?? 0),
          })}
        />
        <StatTile
          label={t('stats.volumes')}
          value={storage(data?.volumes.unusedBytes ?? 0)}
          hint={t('stats.volumesHint', {
            unused: data?.volumes.unused ?? 0,
            anonymous: data?.volumes.anonymous ?? 0,
            total: storage(data?.volumes.totalBytes ?? 0),
          })}
        />
      </div>

      <Card>
        <CardHeader title={t('plan.title')} description={t('plan.description')} />
        <CardBody className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={plan.containers}
              onChange={(event) => change({ containers: event.target.checked })}
              aria-label={t('plan.containers')}
            />
            <span>
              <b className="block font-medium text-ink">{t('plan.containers')}</b>
              <span className="text-subtle">{t('plan.containersHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={plan.networks}
              onChange={(event) => change({ networks: event.target.checked })}
              aria-label={t('plan.networks')}
            />
            <span>
              <b className="block font-medium text-ink">{t('plan.networks')}</b>
              <span className="text-subtle">{t('plan.networksHint')}</span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('plan.images')} hint={t('plan.imagesHint')}>
              {(id) => (
                <Select
                  id={id}
                  value={plan.images}
                  onChange={(event) => change({ images: event.target.value as Plan['images'] })}
                >
                  <option value="none">{t('plan.imagesOptions.none')}</option>
                  <option value="dangling">{t('plan.imagesOptions.dangling')}</option>
                  <option value="unused">{t('plan.imagesOptions.unused')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('plan.volumes')} hint={t('plan.volumesHint')}>
              {(id) => (
                <Select
                  id={id}
                  value={plan.volumes}
                  onChange={(event) => change({ volumes: event.target.value as Plan['volumes'] })}
                >
                  <option value="none">{t('plan.volumesOptions.none')}</option>
                  <option value="anonymous">{t('plan.volumesOptions.anonymous')}</option>
                  <option value="unused">{t('plan.volumesOptions.unused')}</option>
                </Select>
              )}
            </Field>
          </div>
          {withVolumes ? <Callout tone="warn">{t('plan.volumesWarning')}</Callout> : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button size="sm" disabled={nothing} busy={look.isPending} onClick={() => look.mutate()}>
              {t('previewAction')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={nothing || preview === null || preview.items.length === 0}
              onClick={() => setConfirming(true)}
            >
              {t('clean')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPlan(SAFE)
                setPreview(null)
              }}
            >
              {t('reset')}
            </Button>
          </div>
          {look.error ? <ErrorBox error={look.error} /> : null}
        </CardBody>
      </Card>

      {preview ? (
        <Card>
          <CardHeader
            title={t('preview.title', { count: preview.items.length })}
            description={preview.freedBytes > 0 ? t('preview.frees', { size: storage(preview.freedBytes) }) : undefined}
          />
          {preview.items.length === 0 ? (
            <CardBody>
              <p className="text-sm text-subtle">{t('preview.nothing')}</p>
            </CardBody>
          ) : (
            <ul
              className="max-h-96 overflow-y-auto scroll-thin"
              aria-label={t('preview.title', { count: preview.items.length })}
            >
              {preview.items.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-baseline gap-3 border-t border-line px-5 py-2 text-sm first:border-t-0"
                >
                  <span className="w-24 shrink-0 text-xs text-subtle uppercase">{tc(`kinds.${item.kind}`)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">{item.name}</span>
                  <span className="shrink-0 text-xs text-subtle tabular-nums">
                    {item.sizeBytes ? storage(item.sizeBytes) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <p className="text-xs text-subtle">
        {t('buildCache', { size: storage(data?.buildCacheBytes ?? 0) })}{' '}
        <code className="font-mono">docker builder prune</code>
      </p>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('confirm.title', { count: preview?.items.length ?? 0 })}
        impact={preview && preview.freedBytes > 0 ? t('confirm.frees', { size: storage(preview.freedBytes) }) : null}
        details={<p>{withVolumes ? t('confirm.withVolumes') : t('confirm.effect')}</p>}
        requireTyped={typed}
        requireTypedHint={tc('confirm.typedHint', { typed })}
        confirmLabel={t('confirm.action')}
        busy={sweep.isPending}
        error={sweep.error}
        onConfirm={() => sweep.mutate()}
      />
    </div>
  )
}
