'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Play, RotateCw, ScrollText, Square, Trash2 } from 'lucide-react'
import type { ContainerSummary } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../lib/api/index.ts'
import { keys, useContainerRemovalPreview } from '../lib/queries/index.ts'
import { useFormat } from '../lib/use-format.ts'
import { Mono } from './copy.tsx'
import { LogViewer } from './logs.tsx'
import { Callout, ErrorBox } from './shell-bits.tsx'
import { OwnershipBadge } from './status.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui/menu.tsx'
import { useToast } from './ui/toast.tsx'

export function ContainerActions({
  container,
  onShowDetails,
}: {
  container: ContainerSummary
  onShowDetails?: () => void
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'containerActions' })
  const queryClient = useQueryClient()
  const { shortImage } = useFormat()
  const toast = useToast()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

  const act = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => api.containerAction(container.id, action),
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (error) =>
      toast.push({
        tone: 'danger',
        title: t('failed'),
        description:
          error instanceof ApiError
            ? [error.message, error.hint].filter(Boolean).join(' · ')
            : error instanceof Error
              ? error.message
              : String(error),
      }),
  })

  const isGateway = container.ownership === 'gateway'
  const running = container.state === 'running'

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('logs')}
          aria-label={t('logs')}
          onClick={() => setShowLogs(true)}
        >
          <ScrollText />
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('actionsFor', { name: container.name })}>
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {onShowDetails ? (
              <>
                <MenuItem onSelect={onShowDetails}>{t('details')}</MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem disabled={running || isGateway || act.isPending} onSelect={() => act.mutate('start')}>
              <Play className="size-3.5" /> {t('start')}
            </MenuItem>
            <MenuItem disabled={!running || isGateway || act.isPending} onSelect={() => act.mutate('stop')}>
              <Square className="size-3.5" /> {t('stop')}
            </MenuItem>
            <MenuItem disabled={isGateway || act.isPending} onSelect={() => act.mutate('restart')}>
              <RotateCw className="size-3.5" /> {t('restart')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" disabled={isGateway} onSelect={() => setConfirmRemove(true)}>
              <Trash2 className="size-3.5" /> {t('removeContainer')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <RemoveDialog container={container} open={confirmRemove} onOpenChange={setConfirmRemove} />

      <Dialog
        open={showLogs}
        onOpenChange={setShowLogs}
        title={t('logsTitle', { name: container.name })}
        description={shortImage(container.image)}
        size="lg"
      >
        <div className="h-[55vh] min-h-0">
          <LogViewer
            queryKey={keys.containerLogs(container.id)}
            load={(tail) => api.logs(container.id, tail)}
            className="h-full rounded-md border border-line"
          />
        </div>
      </Dialog>
    </>
  )
}

export function RemoveDialog({
  container,
  open,
  onOpenChange,
}: {
  container: ContainerSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'containerActions.remove' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)

  const preview = useContainerRemovalPreview(container.id, open)

  const remove = useMutation({
    mutationFn: () => api.removeContainer(container.id, container.state === 'running'),
    onSuccess: () => {
      onOpenChange(false)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('description')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending || preview.data?.allowed === false}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? t('removing') : t('removeContainer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-line bg-surface-2/60 p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{container.name}</span>
            <OwnershipBadge ownership={container.ownership} />
          </div>
          <div className="mt-1">
            <Mono kind="text">{container.image}</Mono>
          </div>
        </div>

        {preview.data?.namedVolumes.length ? (
          <Callout tone="warn" title={t('namedVolumes', { count: preview.data.namedVolumes.length })}>
            <ul className="mt-1 space-y-0.5">
              {preview.data.namedVolumes.map((volume) => (
                <li key={volume}>
                  <Mono kind="path">{volume}</Mono>
                </li>
              ))}
            </ul>
            <p className="mt-1.5">{t('volumesKept')}</p>
          </Callout>
        ) : null}

        {preview.data?.warnings.length ? (
          <ul className="space-y-1 text-xs text-muted">
            {preview.data.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span className="text-subtle">·</span>
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        {preview.data?.allowed === false ? <Badge tone="danger">{t('notAllowed')}</Badge> : null}

        {error ? <ErrorBox error={error} /> : null}
      </div>
    </Dialog>
  )
}
