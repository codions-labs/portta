'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Play, PlugZap, RotateCw, ScrollText, Share2, Square, TerminalSquare } from 'lucide-react'
import type { Service } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../lib/api/index.ts'
import { useCan } from '../../lib/permissions.ts'
import { keys } from '../../lib/queries/index.ts'
import { accessProblemKey } from '../../lib/services.ts'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { AddressLine, Mono } from '../copy.tsx'
import { ServiceIcon } from '../service-icon.tsx'
import { NoValue } from '../shell-bits.tsx'
import { StateBadge } from '../status.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { Td, Th, Tr } from '../ui/table.tsx'
import { useToast } from '../ui/toast.tsx'
import { OpenTestMenu } from './open-test-menu.tsx'
import { ResourceUsage } from './resource-usage.tsx'

export type ServiceSection = 'overview' | 'logs' | 'console' | 'share' | 'access'

/**
 * One service as one table row: what it is, whether it is up, how to reach
 * it, what it costs, what runs it, and what can be done to it. The one
 * representation of a container the panel has; every list uses it.
 */
export function ServiceRow({
  service,
  showEnvironment = false,
  onOpen,
  className,
}: {
  service: Service
  showEnvironment?: boolean
  onOpen: (section?: ServiceSection) => void
  className?: string
}) {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const { shortId, shortImage, uptime } = useFormat()
  const queryClient = useQueryClient()
  const toast = useToast()
  const access = service.access
  const running = service.state === 'running'
  const mayConsole = useCan('container:console')

  const act = useMutation({
    mutationFn: async (action: 'start' | 'stop' | 'restart') => {
      try {
        return await api.serviceAction(service.environment, service.name, action)
      } catch (error) {
        // A panel that does not serve per-service actions yet still serves
        // the container's, and they mean the same thing for one container.
        if (error instanceof ApiError && error.status === 404) return api.containerAction(service.containerId, action)
        throw error
      }
    },
    onSuccess: (_result, action) => {
      toast.push({
        tone: 'ok',
        title: t('row.actionOk', { name: service.name, action: t(`menu.${action}`) }),
        duration: 2500,
      })
      void queryClient.invalidateQueries({ queryKey: keys.environments() })
      void queryClient.invalidateQueries({ queryKey: keys.services() })
      void queryClient.invalidateQueries({ queryKey: keys.docker() })
    },
    onError: (error) =>
      toast.push({
        tone: 'danger',
        title: t('row.actionFailed'),
        description:
          error instanceof ApiError ? [error.message, error.hint].filter(Boolean).join(' · ') : String(error),
      }),
  })

  const problem = accessProblemKey(access.problem)
  const accessCell = access.primary ? (
    access.kind === 'http' ? (
      <AddressLine value={access.primary.url} href={access.primary.url} className="max-w-full" />
    ) : (
      <AddressLine value={access.primary.url} className="max-w-full" />
    )
  ) : !running ? (
    <span className="text-xs text-subtle">{t('row.stopped', { state: tc(`state.${service.state}`) })}</span>
  ) : problem ? (
    <span className={cn('text-xs', problem === 'noHostname' ? 'text-warn' : 'text-subtle')}>
      {t(`row.problem.${problem}`)}
    </span>
  ) : (
    <span className="text-xs text-subtle">{t('row.noAddress')}</span>
  )

  return (
    <Tr
      aria-label={t('row.label', { name: service.name })}
      className={cn(service.hidden && 'opacity-60', className)}
      data-service={service.name}
    >
      {showEnvironment ? (
        <Td className="text-xs text-muted">
          <a
            className="rounded-xs underline-offset-2 hover:text-ink hover:underline focus-ring"
            href={`/environments/${encodeURIComponent(service.environment)}`}
          >
            {service.environment}
          </a>
        </Td>
      ) : null}
      <Td>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 rounded-xs text-left font-medium text-ink underline-offset-2 hover:underline focus-ring"
            onClick={() => onOpen('overview')}
            aria-label={t('row.openDrawer', { name: service.name })}
          >
            <ServiceIcon tech={service.tech} />
            <span className="truncate">{service.name}</span>
          </button>
          {service.overrides?.note ? <span className="text-xs text-subtle">{service.overrides.note}</span> : null}
          {service.hidden ? <Badge tone="outline">{t('row.hidden')}</Badge> : null}
        </div>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1">
          <StateBadge state={service.state} health={service.health} completed={service.completed} />
          {service.restartCount > 0 ? (
            <Badge tone={service.restartCount > 3 ? 'danger' : 'warn'}>
              {t('row.restarts', { count: service.restartCount })}
            </Badge>
          ) : null}
          {!running && service.exitCode !== null && service.exitCode !== 0 ? (
            <Badge tone="danger">{t('row.exitCode', { code: service.exitCode })}</Badge>
          ) : null}
        </div>
      </Td>
      <Td className="min-w-0 max-w-[22rem]">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">{accessCell}</div>
          {running && (access.endpoints.length > 0 || access.kind === 'tcp') ? (
            <OpenTestMenu service={service} onLogs={() => onOpen('logs')} variant="ghost" />
          ) : null}
        </div>
      </Td>
      <Td className="hidden lg:table-cell">
        {service.resources ? (
          <ResourceUsage
            cpu={service.resources.cpuUtilisation}
            memoryBytes={service.resources.memoryUsedBytes}
            memoryLimitBytes={service.resources.memoryLimitBytes}
            diskBytes={service.resources.diskBytes}
            stale={service.resources.stale}
          />
        ) : (
          <NoValue />
        )}
      </Td>
      <Td className="hidden xl:table-cell">
        <Mono kind="text" title={service.image}>
          {shortImage(service.image)}
        </Mono>
        <Mono kind="id" tone="subtle">
          {' '}
          · {shortId(service.containerId)}
        </Mono>
      </Td>
      <Td className="hidden text-xs text-muted tabular-nums lg:table-cell">{uptime(service.uptimeSeconds)}</Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('menu.logs')}
            aria-label={t('menu.logs')}
            onClick={() => onOpen('logs')}
          >
            <ScrollText />
          </Button>
          {running && mayConsole ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('menu.console')}
              aria-label={t('menu.console')}
              onClick={() => onOpen('console')}
            >
              <TerminalSquare />
            </Button>
          ) : null}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('row.actionsFor', { name: service.name })}>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => onOpen('overview')}>{t('menu.details')}</MenuItem>
              <MenuSeparator />
              <MenuItem disabled={!service.actions.start || act.isPending} onSelect={() => act.mutate('start')}>
                <Play className="size-3.5" /> {t('menu.start')}
              </MenuItem>
              <MenuItem disabled={!service.actions.stop || act.isPending} onSelect={() => act.mutate('stop')}>
                <Square className="size-3.5" /> {t('menu.stop')}
              </MenuItem>
              <MenuItem disabled={!service.actions.restart || act.isPending} onSelect={() => act.mutate('restart')}>
                <RotateCw className="size-3.5" /> {t('menu.restart')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => onOpen('logs')}>
                <ScrollText className="size-3.5" /> {t('menu.logs')}
              </MenuItem>
              {running && mayConsole ? (
                <MenuItem onSelect={() => onOpen('console')}>
                  <TerminalSquare className="size-3.5" /> {t('menu.console')}
                </MenuItem>
              ) : null}
              {service.actions.openAccess ? (
                <MenuItem onSelect={() => onOpen('access')}>
                  <PlugZap className="size-3.5" /> {t('menu.openAccess')}
                </MenuItem>
              ) : null}
              {service.actions.share ? (
                <MenuItem onSelect={() => onOpen('share')}>
                  <Share2 className="size-3.5" /> {t('menu.share')}
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        </div>
      </Td>
    </Tr>
  )
}

/** The header the rows sit under; one definition so every table reads the same. */
export function ServiceTableHead({ showEnvironment = false }: { showEnvironment?: boolean }) {
  const { t } = useTranslation('services', { keyPrefix: 'table' })
  return (
    <thead>
      <tr>
        {showEnvironment ? <Th>{t('environment')}</Th> : null}
        <Th>{t('service')}</Th>
        <Th>{t('state')}</Th>
        <Th>{t('access')}</Th>
        <Th className="hidden lg:table-cell">{t('resources')}</Th>
        <Th className="hidden xl:table-cell">{t('runtime')}</Th>
        <Th className="hidden lg:table-cell">{t('uptime')}</Th>
        <Th className="text-right">{t('actions')}</Th>
      </tr>
    </thead>
  )
}
