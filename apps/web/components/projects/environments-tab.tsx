'use client'

// Which environments this Project adopted, and adopting one more by hand.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvironmentCard } from '@/components/entities/environment-card'
import { Empty, ErrorBox, ToolbarSelect, ViewToolbar } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useEnvironments } from '@/lib/queries'
import { AdoptedRow, sourceKey } from './project-overview'

export function EnvironmentsTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const environments = useEnvironments(true)
  const [adopting, setAdopting] = useState('')
  const mayAdopt = useCan('project:update', project.id) && !readOnly

  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  const adoptedNames = new Set(project.environments.map((entry) => entry.environment))
  const candidates = (environments.data ?? []).filter((environment) => !adoptedNames.has(environment.name))

  const adopt = useMutation({
    mutationFn: (name: string) =>
      api.setProjectEnvironments(project.slug, [
        ...project.environments.filter((entry) => entry.source === 'manual').map((entry) => entry.environment),
        name,
      ]),
    onSuccess: () => {
      setAdopting('')
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
    },
  })

  return (
    <div className="space-y-3">
      {mayAdopt && candidates.length > 0 ? (
        <ViewToolbar className="mb-0">
          <ToolbarSelect
            width="lg"
            value={adopting}
            onChange={(event) => setAdopting(event.target.value)}
            aria-label={t('environments.adopt')}
          >
            <option value="">{t('environments.adopt')}</option>
            {candidates.map((environment) => (
              <option key={environment.name} value={environment.name}>
                {environment.name}
              </option>
            ))}
          </ToolbarSelect>
          <Button size="sm" disabled={adopting === '' || adopt.isPending} onClick={() => adopt.mutate(adopting)}>
            {t('environments.adoptButton')}
          </Button>
          {adopt.error ? <ErrorBox error={adopt.error} /> : null}
        </ViewToolbar>
      ) : null}
      {project.environments.length === 0 ? (
        <Card>
          <Empty title={t('environments.empty')} hint={t('environments.emptyHint')} />
        </Card>
      ) : (
        project.environments.map((entry) => {
          const environment = known.get(entry.environment)
          return environment ? (
            <div key={entry.environment} className="space-y-1">
              <EnvironmentCard
                environment={environment}
                owner={{ slug: project.slug, name: project.name }}
                readOnly={readOnly}
              />
              <p className="px-1 text-2xs text-subtle">{t(sourceKey(entry.source))}</p>
            </div>
          ) : (
            <Card key={entry.environment}>
              <AdoptedRow environment={entry} />
            </Card>
          )
        })
      )}
    </div>
  )
}
