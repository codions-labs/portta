'use client'

// One environment as a row: what it is, where it opens, who may open it and the
// action a person came for. The list of Projects and a Project's own page read
// the same row, so the two cannot disagree about what an environment looks like.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, MoreHorizontal, Play, RotateCw, ScrollText, Square } from 'lucide-react'
import Link from 'next/link'
import type { Environment, ExposureView, RouteUrl } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Mono } from '@/components/copy'
import { canonicalHost } from '@/components/exposure-panel'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { navigate } from '@/lib/navigation'
import { useCan } from '@/lib/permissions'
import { useFormat } from '@/lib/use-format'

/** The address an environment is opened at: its primary service, else `web`, else the first it has. */
export function primaryRoute(environment: Pick<Environment, 'name' | 'urls' | 'overrides'>): RouteUrl | undefined {
  const prefix = (service: string) => `${environment.name}-${service}.`
  const primary = environment.overrides?.primaryService
  return (
    (primary ? environment.urls.find((route) => route.host.startsWith(prefix(primary))) : undefined) ??
    environment.urls.find((route) => route.host.startsWith(prefix('web'))) ??
    environment.urls[0]
  )
}

/** Who may open a hostname on a public host: a credential, everybody, or nobody (no entry means closed). */
export function HostAccess({ mode }: { mode: 'protected' | 'public' | null }) {
  const { t } = useTranslation('overview', { keyPrefix: 'access' })
  return mode === 'protected' ? (
    <Badge tone="ok">{t('protected')}</Badge>
  ) : mode === 'public' ? (
    <Badge tone="info">{t('open')}</Badge>
  ) : (
    <Badge tone="warn">{t('closed')}</Badge>
  )
}

/** An address with its two buttons, the way it reads in every list. */
export function RouteLine({ route }: { route: Pick<RouteUrl, 'url' | 'host'> }) {
  const { t } = useTranslation('overview', { keyPrefix: 'quick' })
  return (
    <>
      <a
        className="min-w-0 flex-1 truncate rounded-xs underline-offset-2 hover:underline focus-ring"
        href={route.url}
        target="_blank"
        rel="noreferrer"
      >
        <Mono kind="url" value={route.url}>
          {route.host}
        </Mono>
      </a>
      <CopyButton value={route.url} />
      <a
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors duration-100 hover:bg-fill hover:text-ink focus-ring [&_svg]:size-4"
        href={route.url}
        target="_blank"
        rel="noreferrer"
        aria-label={t('open')}
        title={t('open')}
      >
        <ExternalLink />
      </a>
    </>
  )
}

/**
 * The action a row is worth, then a menu with the rest: a problem leads to the
 * environment, a stopped one starts, a running one restarts.
 */
function RowActions({ environment }: { environment: Environment }) {
  const { t } = useTranslation('projects', { keyPrefix: 'row' })
  const { t: ta } = useTranslation('environments', { keyPrefix: 'actions' })
  const queryClient = useQueryClient()
  const toast = useToast()
  const mayOperate = useCan('environment:operate')
  const [confirmStop, setConfirmStop] = useState(false)
  const href = `/environments/${encodeURIComponent(environment.name)}`
  const running = environment.runningCount > 0

  const act = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => api.environmentAction(environment.name, action),
    onSuccess: () => {
      setConfirmStop(false)
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.push({ tone: 'danger', title: environment.name, description: String(error) }),
  })

  return (
    <div className="flex shrink-0 items-center justify-end gap-1 md:min-w-38">
      {environment.unhealthyCount > 0 ? (
        <Button asChild size="sm">
          <Link href={href}>{t('seeProblem')}</Link>
        </Button>
      ) : !mayOperate ? null : running ? (
        <Button size="sm" busy={act.isPending} onClick={() => act.mutate('restart')}>
          {ta('restart')}
        </Button>
      ) : environment.startable.ok ? (
        <Button size="sm" busy={act.isPending} onClick={() => act.mutate('start')}>
          {ta('start')}
        </Button>
      ) : (
        <Button asChild size="sm">
          <Link href={href}>{t('howToStart')}</Link>
        </Button>
      )}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('menuFor', { name: environment.name })}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => navigate(href)}>
            <ExternalLink className="size-3.5" /> {t('open')}
          </MenuItem>
          <MenuItem onSelect={() => navigate(`${href}/logs`)}>
            <ScrollText className="size-3.5" /> {t('logs')}
          </MenuItem>
          {mayOperate && running ? (
            <>
              <MenuItem disabled={act.isPending} onSelect={() => act.mutate('restart')}>
                <RotateCw className="size-3.5" /> {ta('restart')}
              </MenuItem>
              <MenuItem disabled={act.isPending} onSelect={() => setConfirmStop(true)}>
                <Square className="size-3.5" /> {ta('stop')}
              </MenuItem>
            </>
          ) : null}
          {mayOperate && !running && environment.startable.ok ? (
            <MenuItem disabled={act.isPending} onSelect={() => act.mutate('start')}>
              <Play className="size-3.5" /> {ta('start')}
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={t('stopTitle', { name: environment.name })}
        impact={t('stopImpact', { count: environment.runningCount })}
        confirmLabel={ta('stop')}
        busy={act.isPending}
        onConfirm={() => act.mutate('stop')}
      />
    </div>
  )
}

export function EnvironmentRow({
  environment,
  exposure,
  extraAction,
}: {
  environment: Environment
  exposure?: ExposureView
  /** Something this list needs beside the usual actions: adopting, for one no Project owns. */
  extraAction?: React.ReactNode
}) {
  const { t } = useTranslation('projects', { keyPrefix: 'row' })
  const { uptime } = useFormat()
  const route = primaryRoute(environment)
  const remembered = environment.presence === 'remembered'
  const mode = route
    ? exposure?.entries.find((entry) => canonicalHost(entry.host) === canonicalHost(route.host))?.mode
    : undefined
  const tone = environment.unhealthyCount > 0 ? 'danger' : environment.runningCount > 0 ? 'ok' : 'neutral'

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-5 py-2.5 transition-colors duration-100 first:border-t-0 hover:bg-fill">
      <Link
        href={`/environments/${encodeURIComponent(environment.name)}`}
        className="min-w-0 flex-[1_1_12rem] rounded-xs focus-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} label={environment.unhealthyCount > 0 ? t('problem') : t('state')} />
          <span className="truncate font-semibold text-ink">
            {environment.overrides?.displayName ?? environment.name}
          </span>
        </span>
        <span className="block truncate text-xs text-subtle">
          {remembered
            ? t('remembered')
            : [
                t('services', { running: environment.runningCount, total: environment.serviceCount }),
                environment.uptimeSeconds !== null ? uptime(environment.uptimeSeconds) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </Link>
      <div className="flex min-w-0 flex-[2_1_15rem] items-center gap-1">
        {route ? (
          <RouteLine route={route} />
        ) : (
          <span className="truncate text-sm text-subtle">
            {remembered && environment.workingDir ? <Mono kind="path">{environment.workingDir}</Mono> : t('noAddress')}
          </span>
        )}
      </div>
      <div className="w-20 shrink-0">{route && exposure?.enforced ? <HostAccess mode={mode ?? null} /> : null}</div>
      {extraAction}
      <RowActions environment={environment} />
    </li>
  )
}
