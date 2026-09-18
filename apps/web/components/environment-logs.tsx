'use client'

import type { Environment, ProjectLogSource } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { navigate } from '../lib/navigation.ts'
import { keys } from '../lib/queries/keys.ts'
import { LogViewer } from './logs.tsx'
import { Empty } from './shell-bits.tsx'
import { Card } from './ui/card.tsx'

export function EnvironmentLogs({ project, service }: { project: Environment; service: string | null }) {
  const { t } = useTranslation('environments')

  const base = `/environments/${encodeURIComponent(project.name)}/logs`

  if (project.services.length === 0) {
    return (
      <Card>
        <Empty title={t('servicesEmpty')} hint={t('servicesEmptyHint')} />
      </Card>
    )
  }

  const selectable: ProjectLogSource[] = project.services.map((item) => ({
    containerId: item.id,
    service: item.service ?? item.name,
    name: item.name,
    state: item.state,
    lineCount: 0,
    truncated: false,
    error: null,
  }))

  return (
    <Card className="flex h-[70vh] min-h-0 flex-col overflow-hidden">
      <LogViewer
        className="min-h-0 flex-1"
        queryKey={keys.environmentLogs(project.name, service)}
        load={(tail) => api.environmentLogs(project.name, { tail, service })}
        sources={selectable}
        selectedService={service}
        onSelectService={(next) => navigate(next ? `${base}?service=${encodeURIComponent(next)}` : base)}
        showOrigin={service === null}
        stream={{ environment: project.name }}
      />
    </Card>
  )
}
