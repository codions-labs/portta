'use client'

// The top of every Project tab: what it is, how it is doing, and the actions a
// person came to take. Opening the site is the main one, restarting the next,
// and everything else waits in the menu.

import { ChevronDown, ExternalLink, RotateCw } from 'lucide-react'
import type { Environment, Project } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { primaryRoute } from '@/components/entities/environment-row'
import {
  affectedBy,
  availableActions,
  ProjectActionsMenu,
  type ProjectActionTarget,
  useProjectLifecycle,
} from '@/components/entities/project-actions'
import { PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCan } from '@/lib/permissions'
import { useEnvironments } from '@/lib/queries'

/** The environment the main button opens: the first running one, else the first. */
function primaryEnvironment(project: Project, environments: Environment[]): Environment | null {
  const known = new Map(environments.map((environment) => [environment.name, environment]))
  const adopted = project.environments
    .map((entry) => known.get(entry.environment))
    .filter((environment): environment is Environment => environment !== undefined)
  return adopted.find((environment) => environment.runningCount > 0) ?? adopted[0] ?? null
}

function RestartAll({ target }: { target: ProjectActionTarget }) {
  const { t } = useTranslation('projects')
  const { t: ta } = useTranslation('projects', { keyPrefix: 'actions' })
  const lifecycle = useProjectLifecycle(target)
  const [confirm, setConfirm] = useState(false)
  const impact = affectedBy(target, 'restart')
  if (!availableActions(target).includes('restart')) return null
  return (
    <>
      <Button busy={lifecycle.isPending} onClick={() => setConfirm(true)}>
        <RotateCw />
        {t('list.restartAll')}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="default"
        title={ta('confirm.restartTitle', { name: target.name })}
        impact={ta('confirm.restartImpact', { count: impact.containers, environments: impact.environments.length })}
        confirmLabel={ta('restart')}
        busy={lifecycle.isPending}
        onConfirm={() => {
          lifecycle.mutate('restart')
          setConfirm(false)
        }}
      />
    </>
  )
}

export function ProjectHeader({ project }: { project: Project }) {
  const { t } = useTranslation('projects')
  const { t: tn } = useTranslation('nav')
  const environments = useEnvironments(true)
  const mayOperate = useCan('environment:operate')

  const primary = primaryEnvironment(project, environments.data ?? [])
  const route = primary ? primaryRoute(primary) : undefined
  const running = project.environments.filter((entry) => entry.running).length
  const unhealthy = project.environments.reduce((sum, entry) => sum + entry.unhealthyCount, 0)
  const target: ProjectActionTarget = {
    slug: project.slug,
    name: project.name,
    archived: project.archived,
    environments: project.environments.map((entry) => ({
      name: entry.environment,
      running: entry.running,
      serviceCount: entry.serviceCount,
      runningCount: entry.runningCount,
      unhealthyCount: entry.unhealthyCount,
    })),
  }

  return (
    <PageHeader
      title={project.name}
      breadcrumb={[{ label: tn('projects'), href: '/projects' }, { label: project.name }]}
      description={project.description ?? undefined}
      meta={
        <>
          {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          {project.environments.length > 0 ? (
            <Badge tone={unhealthy > 0 ? 'danger' : running > 0 ? 'ok' : 'neutral'}>
              {unhealthy > 0
                ? t('pulse.unhealthy', { count: unhealthy })
                : running > 0
                  ? t('state.running')
                  : t('state.idle')}
            </Badge>
          ) : null}
        </>
      }
      actions={
        <>
          {mayOperate ? <RestartAll target={target} /> : null}
          <ProjectActionsMenu
            target={target}
            trigger={
              <Button aria-label={t('actions.menuFor', { name: project.name })}>
                {t('list.more')}
                <ChevronDown className="opacity-60" />
              </Button>
            }
          />
          {route ? (
            <Button asChild variant="primary">
              <a href={route.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t('list.openSite')}
              </a>
            </Button>
          ) : null}
        </>
      }
    />
  )
}
