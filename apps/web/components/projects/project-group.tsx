'use client'

// A Project with its environments, the way the list reads them: the product on
// a band, each environment under it with its address and its next action.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import type { Environment, ExposureView, ProjectSummary } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { EnvironmentRow } from '@/components/entities/environment-row'
import { ProjectActionsMenu, ProjectPrimaryAction } from '@/components/entities/project-actions'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { type ProjectListItem, projectState, projectStateTone } from '@/lib/projects'
import { keys } from '@/lib/queries'

export function ProjectGroup({
  item,
  environments,
  exposure,
}: {
  item: ProjectListItem
  environments: ReadonlyMap<string, Environment>
  exposure?: ExposureView
}) {
  const { t } = useTranslation('projects')
  const href = `/projects/${encodeURIComponent(item.slug)}`
  const state = projectState(item)

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-surface-2/60 px-5 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Link
            href={href}
            className="rounded-xs font-heading text-lg font-semibold text-ink hover:underline focus-ring"
          >
            {item.name}
          </Link>
          <Badge tone={projectStateTone(state)}>{t(`state.${state}`)}</Badge>
          {item.resources ? (
            <ResourceUsage
              cpu={item.resources.cpuUtilisation}
              memoryBytes={item.resources.memoryUsedBytes}
              className="text-xs text-muted"
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild size="sm" variant="ghost">
            <Link href={href}>{t('list.openProject')}</Link>
          </Button>
          <ProjectPrimaryAction target={item} />
          <ProjectActionsMenu target={item} />
        </div>
      </div>
      {item.environments.length === 0 ? (
        <p className="px-5 py-3 text-sm text-subtle">{t('environments.empty')}</p>
      ) : (
        <ul>
          {item.environments.map((facts) => {
            const environment = environments.get(facts.name)
            return environment ? (
              <EnvironmentRow key={facts.name} environment={environment} exposure={exposure} />
            ) : (
              <li key={facts.name} className="border-t border-line px-5 py-2.5 first:border-t-0">
                <Link
                  href={`/environments/${encodeURIComponent(facts.name)}`}
                  className="rounded-xs font-semibold text-ink hover:underline focus-ring"
                >
                  {facts.name}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Adopting by hand from the list, so an environment with no Project is one menu away from having one. */
function AdoptMenu({ environment, projects }: { environment: Environment; projects: readonly ProjectSummary[] }) {
  const { t } = useTranslation('projects', { keyPrefix: 'list' })
  const queryClient = useQueryClient()
  const toast = useToast()
  const adopt = useMutation({
    mutationFn: async (slug: string) => {
      const project = await api.project(slug)
      return api.setProjectEnvironments(slug, [
        ...project.environments.filter((entry) => entry.source === 'manual').map((entry) => entry.environment),
        environment.name,
      ])
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.projects() }),
    onError: (error) => toast.push({ tone: 'danger', title: environment.name, description: String(error) }),
  })
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" busy={adopt.isPending}>
          {t('adoptInto')}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {projects.map((project) => (
          <MenuItem key={project.slug} onSelect={() => adopt.mutate(project.slug)}>
            {project.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

/** What this host runs and no Project adopted: it is still here, and one decision from belonging somewhere. */
export function UnownedGroup({
  environments,
  projects,
  exposure,
}: {
  environments: readonly Environment[]
  projects: readonly ProjectSummary[]
  exposure?: ExposureView
}) {
  const { t } = useTranslation('projects', { keyPrefix: 'list' })
  const mayUpdate = useCan('project:update')
  const adoptable = projects.filter((project) => !project.archived)
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface-2/60 px-5 py-2.5">
        <h2 className="text-lg font-semibold text-ink">{t('unowned')}</h2>
        <Badge tone="neutral">{environments.length}</Badge>
        <span className="text-xs text-muted">{t('unownedHint')}</span>
      </div>
      <ul>
        {environments.map((environment) => (
          <EnvironmentRow
            key={environment.name}
            environment={environment}
            exposure={exposure}
            extraAction={
              mayUpdate && adoptable.length > 0 ? <AdoptMenu environment={environment} projects={adoptable} /> : null
            }
          />
        ))}
      </ul>
    </Card>
  )
}
