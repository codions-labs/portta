'use client'

// The Docker networks on the host, and the way to remove the ones nobody needs.
// Portta's own, Docker's defaults and any a container still references are
// listed and cannot be ticked: removing one of those is how a panel causes an
// incident.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/field'
import { useCan } from '@/lib/permissions'
import { useDockerNetworks } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { LockedNote, ProtectionBadge, ResourceBulkBar, useSelection } from './docker-resources'

const ROLE_TONE = {
  shared: 'accent',
  control: 'info',
  access: 'info',
  project: 'neutral',
  other: 'outline',
} as const

export function NetworksList() {
  const { t } = useTranslation('network')
  const { t: tc } = useTranslation('cleanup')
  const mayRemove = useCan('docker:destroy')
  const query = useDockerNetworks()

  const rows = useMemo(
    () =>
      (query.data?.networks ?? []).map((network) => ({
        ...network,
        pick: { id: network.id, name: network.name, protection: network.protection },
      })),
    [query.data],
  )
  const picks = useMemo(() => rows.map((row) => row.pick), [rows])
  const selection = useSelection(picks, picks)

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  return (
    <div className="space-y-4">
      {selection.selected.length > 0 ? (
        <ResourceBulkBar kind="networks" selected={selection.selected} onClear={selection.clear} />
      ) : null}
      <Card>
        <CardHeader
          title={t('networks.title')}
          actions={
            <span className="flex items-center gap-3">
              {mayRemove ? (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Checkbox
                    checked={selection.everyOn}
                    indeterminate={selection.someOn && !selection.everyOn}
                    disabled={selection.pickable.length === 0}
                    onChange={selection.toggleAll}
                    aria-label={tc('selectAll')}
                  />
                  {tc('networks.selectAllLabel')}
                </label>
              ) : null}
              <span className="text-xs text-subtle tabular-nums">{rows.length}</span>
            </span>
          }
        />
        {rows.length === 0 ? (
          <Empty title={t('networks.empty')} />
        ) : (
          <ul aria-label={t('networks.title')}>
            {rows.map((network) => {
              const locked = network.protection !== null
              const on = !locked && selection.isOn(network.id)
              return (
                <li
                  key={network.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 transition-colors duration-100 first:border-t-0',
                    on ? 'bg-selection' : 'hover:bg-fill',
                  )}
                >
                  {mayRemove ? (
                    <span
                      title={network.protection ? tc(`protection.why.${network.protection}`) : undefined}
                      className="inline-flex"
                    >
                      <Checkbox
                        checked={on}
                        disabled={locked}
                        onChange={() => selection.toggle(network.id)}
                        aria-label={
                          locked ? tc('lockedName', { name: network.name }) : tc('select', { name: network.name })
                        }
                      />
                    </span>
                  ) : null}
                  <Mono kind="host" tone="ink" className="min-w-0 flex-[1_1_12rem] truncate">
                    {network.name}
                  </Mono>
                  {network.internal ? <Badge tone="info">{t('networks.internal')}</Badge> : null}
                  <Badge tone={ROLE_TONE[network.role]}>{t(`networks.roles.${network.role}`)}</Badge>
                  {network.protection ? <ProtectionBadge protection={network.protection} /> : null}
                  <span className="w-28 shrink-0 text-right text-xs text-subtle tabular-nums">
                    {t('networks.count', { count: network.containerCount })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {mayRemove ? <LockedNote>{tc('networks.footnote')}</LockedNote> : null}
    </div>
  )
}
