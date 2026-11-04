'use client'

// What the Docker lists on Host have in common: a row says by itself whether it
// may be removed, selecting is how several go at once, and removing reports what
// went and what did not instead of saying "done". The server decides what may be
// removed (a Portta resource, a Docker default and anything a container uses is
// refused whatever the browser sends); this only keeps the interface from
// offering what would be refused.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import type { DockerProtection, DockerResourceOutcome, DockerResourceRemoveResult } from 'portta-contracts'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '@/lib/api'
import { keys } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { useToast } from '../ui/toast.tsx'

export type ResourceKind = 'networks' | 'images' | 'volumes'

export interface Pickable {
  /** What the server is asked to remove: an id, or a volume's name. */
  id: string
  /** What a person recognises it by. */
  name: string
  sizeBytes?: number | null
  protection: DockerProtection | null
}

const PROTECTION_TONE = { portta: 'info', docker: 'neutral', 'in-use': 'warn' } as const

/** Why a row cannot be ticked, in the row itself rather than in a tooltip alone. */
export function ProtectionBadge({ protection }: { protection: DockerProtection }) {
  const { t } = useTranslation('cleanup')
  return (
    <Badge tone={PROTECTION_TONE[protection]} title={t(`protection.why.${protection}`)}>
      <Lock className="size-3" aria-hidden />
      {t(`protection.${protection}`)}
    </Badge>
  )
}

/**
 * Which rows are ticked.
 *
 * A protected row can never be ticked, and a row that went away since it was
 * ticked is not selected any more, so what the bar counts is what would be sent.
 */
export function useSelection<T extends Pickable>(rows: T[], shown: T[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const pickable = useMemo(() => shown.filter((row) => row.protection === null), [shown])
  const selected = useMemo(() => rows.filter((row) => row.protection === null && picked.has(row.id)), [rows, picked])
  const everyOn = pickable.length > 0 && pickable.every((row) => picked.has(row.id))
  const someOn = pickable.some((row) => picked.has(row.id))

  const toggle = useCallback(
    (id: string) =>
      setPicked((current) => {
        const next = new Set(current)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    [],
  )
  const toggleAll = useCallback(
    () =>
      setPicked((current) => {
        const next = new Set(current)
        for (const row of pickable) {
          if (everyOn) next.delete(row.id)
          else next.add(row.id)
        }
        return next
      }),
    [pickable, everyOn],
  )
  const clear = useCallback(() => setPicked(new Set()), [])

  return { selected, pickable, everyOn, someOn, toggle, toggleAll, clear, isOn: (id: string) => picked.has(id) }
}

function messageOf(reason: unknown): string {
  if (reason instanceof ApiError) return [reason.message, reason.hint].filter(Boolean).join(' · ')
  return reason instanceof Error ? reason.message : String(reason)
}

/** The outcome of a removal or a prune, said once, with the reasons for what stayed. */
export function useAnnounce() {
  const { t } = useTranslation('cleanup')
  const toast = useToast()
  const { storage } = useFormat()

  return useCallback(
    (summary: { removed: number; failed: number; freedBytes: number }, items: DockerResourceOutcome[]) => {
      const stayed = items.filter((item) => !item.ok)
      const freed = summary.freedBytes > 0 ? ` · ${t('freed', { size: storage(summary.freedBytes) })}` : ''
      toast.push({
        tone: summary.failed > 0 ? 'danger' : stayed.length > 0 ? 'warn' : 'ok',
        title: `${t('result.removed', { count: summary.removed })}${freed}`,
        ...(stayed.length > 0
          ? {
              description: stayed
                .slice(0, 8)
                .map((item) => `${item.name}: ${item.reason ?? ''}`)
                .concat(stayed.length > 8 ? [t('result.more', { count: stayed.length - 8 })] : [])
                .join('\n'),
              duration: 0,
            }
          : {}),
      })
    },
    [storage, t, toast],
  )
}

/** Ticked rows, and what can be done to them. */
export function ResourceBulkBar({
  kind,
  selected,
  onClear,
}: {
  kind: ResourceKind
  selected: Pickable[]
  onClear: () => void
}) {
  const { t } = useTranslation('cleanup')
  const { storage } = useFormat()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [confirming, setConfirming] = useState(false)
  const count = selected.length
  const known = selected.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0)

  const remove = useMutation({
    mutationFn: () =>
      api.removeDockerResources(
        kind,
        selected.map((row) => row.id),
      ),
    onSuccess: (result: DockerResourceRemoveResult) => {
      setConfirming(false)
      onClear()
      announce(result, result.results)
      void queryClient.invalidateQueries({ queryKey: keys.docker() })
      void queryClient.invalidateQueries({ queryKey: keys.network() })
    },
  })

  // A volume is somebody's data: it asks for the count to be typed back, the way
  // removing containers does. A network or an image is rebuilt by the next `up`.
  const typed = kind === 'volumes' ? t('confirm.typed', { count }) : undefined

  return (
    <>
      <div
        role="toolbar"
        aria-label={t(`${kind}.bulkAria`)}
        className="flex flex-wrap items-center gap-2 rounded-xl bg-accent py-2 pr-2 pl-4 text-accent-fg"
      >
        <b className="min-w-40 flex-1 text-sm font-semibold">
          {t(`${kind}.selected`, { count })}
          {known > 0 ? <span className="ml-2 font-normal opacity-80">{storage(known)}</span> : null}
        </b>
        <Button
          size="sm"
          className="border-red-400 border-current/40 bg-transparent text-accent-fg hover:bg-current/15 hover:text-accent-fg"
          onClick={() => setConfirming(true)}
        >
          {t('remove')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="border-transparent border-current/40 bg-transparent text-accent-fg hover:bg-current/15 hover:text-accent-fg"
          onClick={onClear}
        >
          {t('clear')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(`${kind}.confirm.title`, { count })}
        impact={null}
        details={
          <div className="space-y-3">
            <ul className="max-h-40 space-y-1 overflow-y-auto scroll-thin">
              {selected.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono">{row.name}</span>
                  {row.sizeBytes ? (
                    <span className="shrink-0 text-xs text-subtle">{storage(row.sizeBytes)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="border-t border-line pt-3">{t(`${kind}.confirm.effect`)}</p>
          </div>
        }
        {...(typed ? { requireTyped: typed, requireTypedHint: t('confirm.typedHint', { typed }) } : {})}
        confirmLabel={t(`${kind}.confirm.action`, { count })}
        busy={remove.isPending}
        error={remove.error ? new Error(messageOf(remove.error)) : undefined}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

/** A line of text under a list: what the locked rows are, in one sentence. */
export function LockedNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-subtle">{children}</p>
}
