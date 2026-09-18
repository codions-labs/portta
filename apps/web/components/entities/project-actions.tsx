'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  Boxes,
  ExternalLink,
  FolderGit2,
  MoreHorizontal,
  Play,
  RotateCw,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../lib/api/index.ts'
import { navigate } from '../../lib/navigation.ts'
import { keys } from '../../lib/queries/index.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { useToast } from '../ui/toast.tsx'

/** What a list row knows about a project's environments; enough to act on them. */
export interface ProjectEnvironmentFacts {
  name: string
  running: boolean
  serviceCount: number
  runningCount: number
  unhealthyCount: number
}

export interface ProjectActionTarget {
  slug: string
  name: string
  archived: boolean
  environments: readonly ProjectEnvironmentFacts[]
}

export type LifecycleAction = 'start' | 'stop' | 'restart'

/** How many containers a lifecycle action would touch, for the confirmation. */
export function affectedBy(
  target: ProjectActionTarget,
  action: LifecycleAction,
): { environments: string[]; containers: number } {
  const environments = target.environments.filter((environment) =>
    action === 'start' ? !environment.running : environment.running,
  )
  return {
    environments: environments.map((environment) => environment.name),
    containers: environments.reduce(
      (sum, environment) => sum + (action === 'start' ? environment.serviceCount : environment.runningCount),
      0,
    ),
  }
}

/**
 * Which lifecycle actions make sense for a project right now.
 *
 * An action that cannot do anything is not offered: "Stop" on a project with
 * nothing running is a button that reports success and changes nothing, which
 * is worse than its absence.
 */
export function availableActions(target: ProjectActionTarget): LifecycleAction[] {
  const running = target.environments.some((environment) => environment.running)
  const stopped = target.environments.some((environment) => !environment.running)
  const actions: LifecycleAction[] = []
  if (stopped) actions.push('start')
  if (running) actions.push('stop', 'restart')
  return actions
}

/**
 * Running a lifecycle action across every environment of a project, with one
 * toast for the outcome rather than one per environment.
 *
 * A project is not a Compose project — it can group several — so there is no
 * single endpoint to call. Failures are collected and reported by name: "2 of
 * 3 environments stopped" is actionable, "something went wrong" is not.
 */
export function useProjectLifecycle(target: ProjectActionTarget) {
  const { t } = useTranslation('projects', { keyPrefix: 'actions' })
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    mutationFn: async (action: LifecycleAction) => {
      const { environments } = affectedBy(target, action)
      const results = await Promise.allSettled(environments.map((name) => api.environmentAction(name, action)))
      const failed = results.flatMap((result, index) =>
        result.status === 'rejected' ? [{ name: environments[index]!, error: result.reason as unknown }] : [],
      )
      return { action, attempted: environments.length, failed }
    },
    onSuccess: ({ action, attempted, failed }) => {
      void queryClient.invalidateQueries()
      if (failed.length === 0) {
        toast.push({
          tone: 'ok',
          duration: 3000,
          title: t(`done.${action}`, { name: target.name, count: attempted }),
        })
        return
      }
      toast.push({
        tone: 'danger',
        title: t(`partial.${action}`, { name: target.name, failed: failed.length, total: attempted }),
        description: failed
          .map((entry) => {
            const reason = entry.error
            const detail =
              reason instanceof ApiError ? [reason.message, reason.hint].filter(Boolean).join(' · ') : String(reason)
            return `${entry.name}: ${detail}`
          })
          .join('\n'),
      })
    },
    onError: (error) =>
      toast.push({
        tone: 'danger',
        title: t('failed', { name: target.name }),
        description: error instanceof Error ? error.message : String(error),
      }),
  })
}

/**
 * The actions a project can take, in a `…` menu.
 *
 * The rule this follows everywhere in the panel: the action somebody wants
 * most is a visible button, and everything else lives behind one menu. What
 * appears in the menu depends on the project's state, and anything that
 * cannot be undone asks first, naming what it will do.
 */
export function ProjectActionsMenu({
  target,
  align = 'end',
  trigger,
}: {
  target: ProjectActionTarget
  align?: 'start' | 'end'
  trigger?: React.ReactNode
}) {
  const { t: ta } = useTranslation('projects', { keyPrefix: 'actions' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const toast = useToast()
  const lifecycle = useProjectLifecycle(target)
  const [confirm, setConfirm] = useState<'stop' | 'restart' | 'delete' | null>(null)

  const base = `/projects/${encodeURIComponent(target.slug)}`
  const actions = availableActions(target)

  const archive = useMutation({
    mutationFn: () => api.patchProject(target.slug, { archived: !target.archived }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      void queryClient.invalidateQueries({ queryKey: keys.project(target.slug) })
      toast.push({
        tone: 'ok',
        duration: 3000,
        title: ta(target.archived ? 'done.unarchive' : 'done.archive', { name: target.name }),
      })
    },
    onError: (error) =>
      toast.push({ tone: 'danger', title: ta('failed', { name: target.name }), description: String(error) }),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteProject(target.slug),
    onSuccess: (result) => {
      void queryClient.invalidateQueries()
      setConfirm(null)
      toast.push({ tone: 'ok', title: ta('done.delete', { name: target.name }), description: result.note })
    },
    onError: (error) =>
      toast.push({ tone: 'danger', title: ta('failed', { name: target.name }), description: String(error) }),
  })

  const stopImpact = affectedBy(target, 'stop')
  const restartImpact = affectedBy(target, 'restart')

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          {trigger ?? (
            <Button variant="ghost" size="icon" aria-label={ta('menuFor', { name: target.name })}>
              <MoreHorizontal />
            </Button>
          )}
        </MenuTrigger>
        <MenuContent align={align}>
          <MenuItem onSelect={() => navigate(base)}>
            <ExternalLink className="size-3.5" /> {tc('open')}
          </MenuItem>
          <MenuItem onSelect={() => navigate(`${base}/repositories`)}>
            <FolderGit2 className="size-3.5" /> {ta('openRepositories')}
          </MenuItem>
          <MenuItem onSelect={() => navigate(`${base}/environments`)}>
            <Boxes className="size-3.5" /> {ta('openEnvironments')}
          </MenuItem>

          {actions.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuLabel>{ta('label')}</MenuLabel>
              {actions.includes('start') ? (
                <MenuItem
                  disabled={lifecycle.isPending}
                  hint={affectedBy(target, 'start').environments.length}
                  onSelect={() => lifecycle.mutate('start')}
                >
                  <Play className="size-3.5" /> {ta('start')}
                </MenuItem>
              ) : null}
              {actions.includes('stop') ? (
                <MenuItem
                  disabled={lifecycle.isPending}
                  hint={stopImpact.environments.length}
                  onSelect={() => setConfirm('stop')}
                >
                  <Square className="size-3.5" /> {ta('stop')}
                </MenuItem>
              ) : null}
              {actions.includes('restart') ? (
                <MenuItem
                  disabled={lifecycle.isPending}
                  hint={restartImpact.environments.length}
                  onSelect={() => setConfirm('restart')}
                >
                  <RotateCw className="size-3.5" /> {ta('restart')}
                </MenuItem>
              ) : null}
            </>
          ) : null}

          <MenuSeparator />
          <MenuItem onSelect={() => navigate(`${base}/settings`.replace(/^#/, ''))}>
            <Settings2 className="size-3.5" /> {ta('settings')}
          </MenuItem>
          <MenuItem
            disabled={archive.isPending}
            icon={target.archived ? <ArchiveRestore /> : <Archive />}
            onSelect={() => archive.mutate()}
          >
            {ta(target.archived ? 'unarchive' : 'archive')}
          </MenuItem>
          <MenuItem tone="danger" onSelect={() => setConfirm('delete')}>
            <Trash2 className="size-3.5" /> {ta('delete')}
          </MenuItem>
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirm === 'stop'}
        onOpenChange={(open) => setConfirm(open ? 'stop' : null)}
        title={ta('confirm.stopTitle', { name: target.name })}
        impact={ta('confirm.stopImpact', {
          count: stopImpact.containers,
          environments: stopImpact.environments.length,
        })}
        details={<EnvironmentList names={stopImpact.environments} />}
        confirmLabel={ta('stop')}
        busy={lifecycle.isPending}
        onConfirm={() => {
          lifecycle.mutate('stop')
          setConfirm(null)
        }}
      />

      <ConfirmDialog
        open={confirm === 'restart'}
        onOpenChange={(open) => setConfirm(open ? 'restart' : null)}
        tone="default"
        title={ta('confirm.restartTitle', { name: target.name })}
        impact={ta('confirm.restartImpact', {
          count: restartImpact.containers,
          environments: restartImpact.environments.length,
        })}
        details={<EnvironmentList names={restartImpact.environments} />}
        confirmLabel={ta('restart')}
        busy={lifecycle.isPending}
        onConfirm={() => {
          lifecycle.mutate('restart')
          setConfirm(null)
        }}
      />

      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => setConfirm(open ? 'delete' : null)}
        title={ta('confirm.deleteTitle', { name: target.name })}
        impact={ta('confirm.deleteImpact')}
        details={<p className="text-xs text-muted">{ta('confirm.deleteKeeps')}</p>}
        confirmLabel={ta('delete')}
        requireTyped={target.slug}
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

function EnvironmentList({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <ul className="list-inside list-disc font-mono text-xs text-ink">
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  )
}

/**
 * The one action worth a button of its own on a card or a row: start what is
 * stopped, or stop what is running. Everything else is in the menu beside it.
 */
export function ProjectPrimaryAction({ target }: { target: ProjectActionTarget }) {
  const { t } = useTranslation('projects', { keyPrefix: 'actions' })
  const lifecycle = useProjectLifecycle(target)
  const [confirmStop, setConfirmStop] = useState(false)
  const actions = availableActions(target)
  const running = actions.includes('stop')
  if (actions.length === 0) return null
  const impact = affectedBy(target, running ? 'stop' : 'start')

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        busy={lifecycle.isPending}
        title={running ? t('stop') : t('start')}
        aria-label={`${running ? t('stop') : t('start')} ${target.name}`}
        onClick={() => (running ? setConfirmStop(true) : lifecycle.mutate('start'))}
      >
        {running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={t('confirm.stopTitle', { name: target.name })}
        impact={t('confirm.stopImpact', { count: impact.containers, environments: impact.environments.length })}
        details={<EnvironmentList names={impact.environments} />}
        confirmLabel={t('stop')}
        busy={lifecycle.isPending}
        onConfirm={() => {
          lifecycle.mutate('stop')
          setConfirmStop(false)
        }}
      />
    </>
  )
}
