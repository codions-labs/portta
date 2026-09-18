'use client'

// Containers of adopted projects, as one table over every environment.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ServiceTable } from '@/components/entities/service-table'
import { ErrorBox, Loading, PageHeader, ToolbarSearch, ToolbarSelect, ViewToolbar } from '@/components/shell-bits'
import { Card } from '@/components/ui/card'
import { useServices } from '@/lib/queries'
import { serviceFromContainer } from '@/lib/services'

export function ServicesView() {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const query = useServices()

  const services = useMemo(() => {
    let list = query.data ?? []
    if (state === 'running') list = list.filter((service) => service.state === 'running')
    if (state === 'stopped') list = list.filter((service) => service.state !== 'running')
    if (state === 'unhealthy') list = list.filter((service) => service.health === 'unhealthy')
    if (state === 'http') list = list.filter((service) => service.traefikEnabled)
    if (state === 'tcp') list = list.filter((service) => !service.traefikEnabled)
    if (search.trim() !== '') {
      const needle = search.toLowerCase()
      list = list.filter((service) =>
        [service.environment, service.service, service.image, ...service.urls.map((url) => url.host)]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    }
    return list
  }, [query.data, search, state])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

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
        <ToolbarSelect value={state} onChange={(event) => setState(event.target.value)} aria-label={t('filterAria')}>
          <option value="all">{tc('all')}</option>
          <option value="running">{tc('running')}</option>
          <option value="stopped">{tc('stopped')}</option>
          <option value="unhealthy">{tc('unhealthy')}</option>
          <option value="http">{t('filters.http')}</option>
          <option value="tcp">{t('filters.tcp')}</option>
        </ToolbarSelect>
      </ViewToolbar>

      <Card>
        <ServiceTable
          services={services.map((container) => serviceFromContainer(container))}
          containers={services}
          showEnvironment
          emptyTitle={t('empty')}
        />
      </Card>
    </>
  )
}
