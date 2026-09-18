'use client'

import type { ContainerSummary, Service } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Empty } from '../shell-bits.tsx'
import { Table } from '../ui/table.tsx'
import { ServiceDrawer } from './service-drawer.tsx'
import { ServiceRow, type ServiceSection, ServiceTableHead } from './service-row.tsx'

/**
 * Rows plus the drawer they open. `containers` is what the drawer reads the
 * rest from; a row whose container is unknown still opens, with what it has.
 */
export function ServiceTable({
  services,
  containers,
  showEnvironment = false,
  initialService = null,
  initialSection = 'overview',
  onSelect,
  emptyTitle,
  emptyHint,
}: {
  services: Service[]
  containers: ContainerSummary[]
  showEnvironment?: boolean
  /** A service to open on mount, when the URL names one. */
  initialService?: string | null
  initialSection?: ServiceSection
  /** Called when the selection changes, so a page can put it in the URL. */
  onSelect?: (service: string | null) => void
  emptyTitle?: string
  emptyHint?: string
}) {
  const { t } = useTranslation('services')
  const [selected, setSelected] = useState<{ id: string; section: ServiceSection } | null>(() =>
    initialService
      ? { id: services.find((s) => s.name === initialService)?.containerId ?? '', section: initialSection }
      : null,
  )
  const current = selected ? (containers.find((container) => container.id === selected.id) ?? null) : null
  const currentService = selected ? (services.find((service) => service.containerId === selected.id) ?? null) : null

  if (services.length === 0) return <Empty title={emptyTitle ?? t('empty')} hint={emptyHint} />

  return (
    <>
      <Table>
        <ServiceTableHead showEnvironment={showEnvironment} />
        <tbody>
          {services.map((service) => (
            <ServiceRow
              key={service.containerId}
              service={service}
              showEnvironment={showEnvironment}
              onOpen={(section = 'overview') => {
                setSelected({ id: service.containerId, section })
                onSelect?.(service.name)
              }}
            />
          ))}
        </tbody>
      </Table>
      {current ? (
        <ServiceDrawer
          container={current}
          service={currentService}
          section={selected?.section ?? 'overview'}
          open
          onOpenChange={(open) => {
            if (open) return
            setSelected(null)
            onSelect?.(null)
          }}
        />
      ) : null}
    </>
  )
}
