'use client'

// Every Docker volume with the size it takes. A volume is data, often a
// database: the ones a container still mounts, and Portta's own, are listed and
// cannot be ticked, and removing the others asks for the count to be typed back.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { LockedNote, ProtectionBadge, ResourceBulkBar, useSelection } from '@/components/host/docker-resources'
import { Empty, ErrorBox, FilterChip, Loading, ToolbarSearch, ViewToolbar } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/field'
import { useCan } from '@/lib/permissions'
import { useDockerVolumes } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'unused' | 'used'

const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2.6fr)_6rem_minmax(0,1.2fr)_5.5rem_minmax(0,1fr)]'
const COLUMNS_SELECTABLE =
  'grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,2.6fr)_6rem_minmax(0,1.2fr)_5.5rem_minmax(0,1fr)]'

export function VolumesView() {
  const { t } = useTranslation('cleanup')
  const { storage, relativeTime } = useFormat()
  const mayRemove = useCan('docker:destroy')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const query = useDockerVolumes()

  const rows = useMemo(
    () =>
      (query.data?.volumes ?? []).map((volume) => ({
        ...volume,
        pick: {
          id: volume.name,
          // An anonymous volume is a 64-character hash: the short form is what anybody can read.
          name: volume.anonymous ? `${volume.name.slice(0, 12)}…` : volume.name,
          sizeBytes: volume.sizeBytes,
          protection: volume.protection,
        },
      })),
    [query.data],
  )

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter(
      (row) =>
        (filter === 'all' || (filter === 'unused' ? row.containerCount === 0 : row.containerCount > 0)) &&
        (needle === '' || [row.name, row.project ?? ''].join(' ').toLowerCase().includes(needle)),
    )
  }, [rows, filter, search])

  const picks = useMemo(() => rows.map((row) => row.pick), [rows])
  const shownPicks = useMemo(() => shown.map((row) => row.pick), [shown])
  const selection = useSelection(picks, shownPicks)

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  const data = query.data

  return (
    <div className="space-y-4">
      <ViewToolbar
        trailing={
          <ToolbarSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('volumes.searchPlaceholder')}
            aria-label={t('volumes.searchAria')}
          />
        }
      >
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('volumes.chips.all', { count: rows.length })}
        </FilterChip>
        <FilterChip active={filter === 'unused'} onClick={() => setFilter('unused')}>
          {t('volumes.chips.unused', { count: rows.filter((row) => row.containerCount === 0).length })}
        </FilterChip>
        <FilterChip active={filter === 'used'} onClick={() => setFilter('used')}>
          {t('volumes.chips.used', { count: rows.filter((row) => row.containerCount > 0).length })}
        </FilterChip>
      </ViewToolbar>

      <p className="text-sm text-muted">
        {t('volumes.total', { size: storage(data?.totalBytes ?? 0), count: rows.length })}
        {data && data.reclaimableBytes > 0
          ? ` · ${t('volumes.reclaimable', { size: storage(data.reclaimableBytes) })}`
          : ''}
      </p>

      {selection.selected.length > 0 ? (
        <ResourceBulkBar kind="volumes" selected={selection.selected} onClear={selection.clear} />
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
          <span>{t('volumes.columns.volume')}</span>
          <span className="hidden text-right md:block">{t('volumes.columns.size')}</span>
          <span className="hidden md:block">{t('volumes.columns.project')}</span>
          <span className="hidden md:block">{t('volumes.columns.created')}</span>
          <span className="hidden md:block">{t('volumes.columns.status')}</span>
        </div>

        {shown.length === 0 ? (
          <Empty title={t('volumes.empty')} />
        ) : (
          <ul aria-label={t('volumes.title')}>
            {shown.map((row) => {
              const locked = row.protection !== null
              const on = !locked && selection.isOn(row.name)
              return (
                <li
                  key={row.name}
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
                        onChange={() => selection.toggle(row.name)}
                        aria-label={
                          locked ? t('lockedName', { name: row.pick.name }) : t('select', { name: row.pick.name })
                        }
                      />
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <Mono kind="text" tone="ink" className="block truncate font-semibold" title={row.name}>
                      {row.pick.name}
                    </Mono>
                    <span className="block truncate text-xs text-subtle">
                      {t('volumes.mountedBy', { count: row.containerCount })}
                    </span>
                  </div>
                  <span className="hidden text-right text-sm tabular-nums md:block">
                    {row.sizeBytes === null ? t('volumes.sizeUnknown') : storage(row.sizeBytes)}
                  </span>
                  <span className="hidden min-w-0 truncate font-mono text-xs text-muted md:block">
                    {row.project ?? '—'}
                  </span>
                  <span className="hidden text-xs text-subtle md:block">
                    {row.createdAt === null ? '—' : relativeTime(row.createdAt)}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 md:justify-start">
                    {row.protection ? <ProtectionBadge protection={row.protection} /> : null}
                    {row.anonymous ? <Badge tone="outline">{t('volumes.anonymous')}</Badge> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {mayRemove ? <LockedNote>{t('volumes.footnote')}</LockedNote> : null}
    </div>
  )
}
