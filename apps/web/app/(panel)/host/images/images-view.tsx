'use client'

// Every image on the host, with the size it takes, so cleaning is a decision and
// not a guess. An image a container was created from, and Portta's own, are
// listed and cannot be ticked.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { LockedNote, ProtectionBadge, ResourceBulkBar, useSelection } from '@/components/host/docker-resources'
import { Empty, ErrorBox, FilterChip, Loading, ToolbarSearch, ViewToolbar } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/field'
import { useCan } from '@/lib/permissions'
import { useDockerImages } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'unused' | 'dangling' | 'used'

const COLUMNS = 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2.6fr)_6rem_5.5rem_7rem_minmax(0,1fr)]'
const COLUMNS_SELECTABLE =
  'grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,2.6fr)_6rem_5.5rem_7rem_minmax(0,1fr)]'

export function ImagesView() {
  const { t } = useTranslation('cleanup')
  const { storage, relativeTime } = useFormat()
  const mayRemove = useCan('docker:destroy')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const query = useDockerImages()

  const rows = useMemo(
    () =>
      (query.data?.images ?? []).map((image) => ({
        ...image,
        // The first tag is the name; an untagged image is known by its id.
        label: image.tags[0] ?? image.id.slice(0, 12),
        pick: {
          id: image.id,
          name: image.tags[0] ?? image.id.slice(0, 12),
          sizeBytes: image.uniqueBytes,
          protection: image.protection,
        },
      })),
    [query.data],
  )

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter(
      (row) =>
        (filter === 'all' ||
          (filter === 'dangling' && row.dangling) ||
          (filter === 'unused' && row.containerCount === 0) ||
          (filter === 'used' && row.containerCount > 0)) &&
        (needle === '' || [...row.tags, row.id].join(' ').toLowerCase().includes(needle)),
    )
  }, [rows, filter, search])

  const picks = useMemo(() => rows.map((row) => row.pick), [rows])
  const shownPicks = useMemo(() => shown.map((row) => row.pick), [shown])
  const selection = useSelection(picks, shownPicks)

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  const data = query.data
  const count = (pick: (row: (typeof rows)[number]) => boolean) => rows.filter(pick).length

  return (
    <div className="space-y-4">
      <ViewToolbar
        trailing={
          <ToolbarSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('images.searchPlaceholder')}
            aria-label={t('images.searchAria')}
          />
        }
      >
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('images.chips.all', { count: rows.length })}
        </FilterChip>
        <FilterChip active={filter === 'unused'} onClick={() => setFilter('unused')}>
          {t('images.chips.unused', { count: count((row) => row.containerCount === 0) })}
        </FilterChip>
        <FilterChip active={filter === 'dangling'} onClick={() => setFilter('dangling')}>
          {t('images.chips.dangling', { count: count((row) => row.dangling) })}
        </FilterChip>
        <FilterChip active={filter === 'used'} onClick={() => setFilter('used')}>
          {t('images.chips.used', { count: count((row) => row.containerCount > 0) })}
        </FilterChip>
      </ViewToolbar>

      <p className="text-sm text-muted">
        {t('images.total', { size: storage(data?.totalBytes ?? 0), count: rows.length })}
        {data && data.reclaimableBytes > 0
          ? ` · ${t('images.reclaimable', { size: storage(data.reclaimableBytes) })}`
          : ''}
      </p>

      {selection.selected.length > 0 ? (
        <ResourceBulkBar kind="images" selected={selection.selected} onClear={selection.clear} />
      ) : null}

      <Card>
        <div
          className={cn(
            'grid items-center gap-x-4 border-b border-line bg-surface-2 px-5 py-2 text-xs font-medium tracking-[0.06em] text-subtle uppercase',
            mayRemove ? COLUMNS_SELECTABLE : COLUMNS,
          )}
        >
          {mayRemove ? (
            <Checkbox
              checked={selection.everyOn}
              indeterminate={selection.someOn && !selection.everyOn}
              disabled={selection.pickable.length === 0}
              onChange={selection.toggleAll}
              aria-label={t('selectAll')}
            />
          ) : null}
          <span>{t('images.columns.image')}</span>
          <span className="hidden text-right md:block">{t('images.columns.size')}</span>
          <span className="hidden md:block">{t('images.columns.created')}</span>
          <span className="hidden md:block">{t('images.columns.containers')}</span>
          <span className="hidden md:block">{t('images.columns.status')}</span>
        </div>

        {shown.length === 0 ? (
          <Empty title={t('images.empty')} />
        ) : (
          <ul aria-label={t('images.title')}>
            {shown.map((row) => {
              const locked = row.protection !== null
              const on = !locked && selection.isOn(row.id)
              return (
                <li
                  key={row.id}
                  className={cn(
                    'grid items-center gap-x-4 border-t border-line px-5 py-2 transition-colors duration-100 first:border-t-0',
                    mayRemove ? COLUMNS_SELECTABLE : COLUMNS,
                    on ? 'bg-selection' : 'hover:bg-fill',
                  )}
                >
                  {mayRemove ? (
                    <span
                      title={locked ? t(`protection.why.${row.protection ?? 'in-use'}`) : undefined}
                      className="inline-flex"
                    >
                      <Checkbox
                        checked={on}
                        disabled={locked}
                        onChange={() => selection.toggle(row.id)}
                        aria-label={locked ? t('lockedName', { name: row.label }) : t('select', { name: row.label })}
                      />
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <Mono kind="text" tone="ink" className="block truncate font-semibold" title={row.tags.join('\n')}>
                      {row.label}
                    </Mono>
                    <span className="block truncate text-xs text-subtle">
                      {row.tags.length > 1 ? `${t('images.moreTags', { count: row.tags.length - 1 })} · ` : ''}
                      <span className="font-mono">{row.id.slice(0, 12)}</span>
                    </span>
                  </div>
                  <span
                    className="hidden text-right text-sm tabular-nums md:block"
                    title={
                      row.uniqueBytes === null ? undefined : t('images.uniqueHint', { size: storage(row.uniqueBytes) })
                    }
                  >
                    {storage(row.sizeBytes)}
                  </span>
                  <span className="hidden text-xs text-subtle md:block">{relativeTime(row.createdAt)}</span>
                  <span className="hidden text-xs text-muted md:block">
                    {t('images.containerCount', { count: row.containerCount })}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 md:justify-start">
                    {row.protection ? <ProtectionBadge protection={row.protection} /> : null}
                    {row.dangling ? <Badge tone="outline">{t('images.dangling')}</Badge> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {mayRemove ? <LockedNote>{t('images.footnote')}</LockedNote> : null}
    </div>
  )
}
