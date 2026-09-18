'use client'

import type { ContainerSummary, MetricsCurrent, Ownership } from 'portta-contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { ContainerTable } from '@/components/entities/container-table'
import { ServiceDrawer } from '@/components/entities/service-drawer'
import {
  Empty,
  ErrorBox,
  KeyValue,
  Loading,
  PageHeader,
  StatTile,
  ToolbarSearch,
  ToolbarSelect,
  ViewToolbar,
} from '@/components/shell-bits'
import { OwnershipBadge } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { ColumnsMenu, useTableArrangement } from '@/components/ui/table-arrangement'
import { useContainers, useDockerHost, useMetricsCurrent } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

const GROUP_KEYS: Ownership[] = ['gateway', 'integrated', 'external', 'standalone']

export function DockerView() {
  const { t } = useTranslation('docker')
  const { t: tc } = useTranslation('common')
  const { bytes } = useFormat()
  const [search, setSearch] = useState('')
  const [ownership, setOwnership] = useState<'all' | Ownership>('all')
  const [state, setState] = useState('all')
  const [details, setDetails] = useState<ContainerSummary | null>(null)

  const host = useDockerHost()
  const containers = useContainers()
  // What each container costs comes from the collector, joined by container id.
  const metrics = useMetricsCurrent()

  const filtered = useMemo(() => {
    let list = containers.data?.containers ?? []
    if (ownership !== 'all') list = list.filter((container) => container.ownership === ownership)
    if (state === 'running') list = list.filter((container) => container.state === 'running')
    if (state === 'stopped') list = list.filter((container) => container.state !== 'running')
    if (state === 'unhealthy') list = list.filter((container) => container.health === 'unhealthy')
    if (search.trim() !== '') {
      const needle = search.toLowerCase()
      list = list.filter((container) =>
        [container.name, container.image, container.environment ?? '', container.service ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    }
    return list
  }, [containers.data, ownership, state, search])

  if (containers.isPending) return <Loading />
  if (containers.error) return <ErrorBox error={containers.error} />

  const conflicts = (host.data?.ports ?? []).filter((port) => port.conflict)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ViewToolbar>
        <ToolbarSearch
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchAria')}
        />
        <ToolbarSelect
          width="lg"
          value={ownership}
          onChange={(event) => setOwnership(event.target.value as 'all' | Ownership)}
          aria-label={t('filterOwnership')}
        >
          <option value="all">{tc('all')}</option>
          <option value="gateway">{tc('ownership.gateway')}</option>
          <option value="integrated">{tc('ownership.integrated')}</option>
          <option value="external">{tc('ownership.external')}</option>
          <option value="standalone">{tc('ownership.standalone')}</option>
        </ToolbarSelect>
        <ToolbarSelect value={state} onChange={(event) => setState(event.target.value)} aria-label={t('filterState')}>
          <option value="all">{t('anyState')}</option>
          <option value="running">{tc('running')}</option>
          <option value="stopped">{tc('stopped')}</option>
          <option value="unhealthy">{tc('unhealthy')}</option>
        </ToolbarSelect>
      </ViewToolbar>

      {host.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label={t('stats.running')}
            value={host.data.containers.running}
            hint={t('containersTotal', { total: host.data.containers.total })}
          />
          <StatTile label={t('stats.gateway')} value={host.data.byOwnership.gateway} />
          <StatTile label={t('stats.integrated')} value={host.data.byOwnership.integrated} />
          <StatTile
            label={t('stats.external')}
            value={host.data.byOwnership.external + host.data.byOwnership.standalone}
          />
          <StatTile label={t('stats.networks')} value={host.data.networks.length} />
          <StatTile
            label={t('stats.portConflicts')}
            value={conflicts.length}
            tone={conflicts.length > 0 ? 'warn' : 'ok'}
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {ownership === 'all' ? (
          GROUP_KEYS.map((key) => {
            const rows = filtered.filter((container) => container.ownership === key)
            if (rows.length === 0) return null
            return (
              <ContainerGroup
                key={key}
                title={t(`groups.${key}.title`)}
                description={t(`groups.${key}.description`)}
                containers={rows}
                metrics={metrics.data}
                storageKey={`docker-${key}`}
                onDetails={setDetails}
              />
            )
          })
        ) : (
          <ContainerGroup
            title={t(`groups.${ownership}.title`)}
            description={t(`groups.${ownership}.description`)}
            containers={filtered}
            metrics={metrics.data}
            storageKey={`docker-${ownership}`}
            onDetails={setDetails}
          />
        )}

        {filtered.length === 0 ? (
          <Card>
            <Empty title={t('empty')} />
          </Card>
        ) : null}
      </div>

      {host.data ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('publishedPorts.title')} description={t('publishedPorts.description')} />
            {host.data.ports.length === 0 ? (
              <Empty title={t('publishedPorts.empty')} />
            ) : (
              <Table aria-label={t('publishedPorts.aria')}>
                <thead>
                  <tr>
                    <Th>{t('publishedPorts.hostPort')}</Th>
                    <Th>{t('publishedPorts.container')}</Th>
                    <Th>{t('publishedPorts.owner')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {host.data.ports.map((port) => (
                    <Tr key={`${port.hostPort}/${port.protocol}`}>
                      <Td>
                        <Mono kind="port" tone="ink">
                          {port.hostPort}/{port.protocol}
                        </Mono>
                        {port.conflict ? (
                          <Badge tone="warn" className="ml-2">
                            {t('publishedPorts.conflictBadge')}
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {port.bindings.map((binding) => (
                          <div key={binding.containerId + binding.ip}>
                            <Mono kind="host">{binding.ip}</Mono> {binding.containerName}
                          </div>
                        ))}
                      </Td>
                      <Td>
                        {[...new Set(port.bindings.map((binding) => binding.ownership))].map((owner) => (
                          <OwnershipBadge key={owner} ownership={owner} />
                        ))}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title={t('engine.title')} />
            <CardBody>
              <dl className="divide-y divide-line-subtle">
                <KeyValue label={t('engine.docker')}>
                  {host.data.engine.version} (API {host.data.engine.apiVersion})
                </KeyValue>
                <KeyValue label={t('engine.host')}>{host.data.engine.name}</KeyValue>
                <KeyValue label={t('engine.platform')}>
                  {host.data.engine.os} · {host.data.engine.arch}
                </KeyValue>
                <KeyValue label={t('engine.resources')}>
                  {host.data.engine.cpus} CPU · {bytes(host.data.engine.memoryBytes)}
                </KeyValue>
              </dl>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {details ? (
        <ServiceDrawer container={details} open={details !== null} onOpenChange={(open) => !open && setDetails(null)} />
      ) : null}
    </>
  )
}

function ContainerGroup({
  title,
  description,
  containers,
  metrics,
  storageKey,
  onDetails,
}: {
  title: string
  description: string
  containers: ContainerSummary[]
  metrics?: MetricsCurrent
  storageKey: string
  onDetails: (container: ContainerSummary) => void
}) {
  const { t } = useTranslation('docker')
  // The card's header is this group's toolbar: what the group is, and the
  // one control its table has.
  const table = useTableArrangement(storageKey)
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        meta={<span className="text-xs font-normal text-subtle tabular-nums">{containers.length}</span>}
        actions={<ColumnsMenu arrangement={table} />}
      />
      <ContainerTable
        containers={containers}
        metrics={metrics}
        storageKey={storageKey}
        arrangement={table}
        caption={t('table.caption', { group: title })}
        onDetails={onDetails}
      />
    </Card>
  )
}
