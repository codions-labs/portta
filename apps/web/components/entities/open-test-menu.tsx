'use client'

import * as Primitive from '@radix-ui/react-dropdown-menu'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Copy, ExternalLink, PlugZap, ScrollText } from 'lucide-react'
import type { Environment, Service } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../lib/api/index.ts'
import { useCopy } from '../../lib/clipboard.ts'
import { orderEndpoints } from '../../lib/endpoints.ts'
import { navigate } from '../../lib/navigation.ts'
import { keys, useServiceConnection } from '../../lib/queries/index.ts'
import { endpointsByScope } from '../../lib/services.ts'
import { ConnectionDetails } from '../connection-panel.tsx'
import { Mono } from '../copy.tsx'
import { Loading } from '../shell-bits.tsx'
import { Button } from '../ui/button.tsx'
import { Dialog } from '../ui/dialog.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { overlayLabel } from '../ui/surfaces.ts'
import { useToast } from '../ui/toast.tsx'

function ScopeLabel({ children }: { children: React.ReactNode }) {
  return <Primitive.Label className={overlayLabel}>{children}</Primitive.Label>
}

function open(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * "I want to test this service": every way to reach it, by scope, in one
 * menu. An HTTP address opens; a datastore address copies, opens a loopback
 * bridge or shows the connection string. The person never has to know which
 * network is behind it.
 */
export function OpenTestMenu({
  service,
  onLogs,
  size = 'sm',
  variant = 'default',
}: {
  service: Service
  onLogs?: () => void
  size?: 'sm' | 'md'
  variant?: 'default' | 'primary' | 'ghost'
}) {
  const { t } = useTranslation('services', { keyPrefix: 'menu' })
  const { t: tc } = useTranslation('common')
  const { copy } = useCopy()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [connection, setConnection] = useState(false)
  const access = service.access
  const groups = endpointsByScope(access.endpoints)

  const bridge = useMutation({
    mutationFn: () => api.openBridge({ project: service.environment, service: service.name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.access() })
      void queryClient.invalidateQueries({ queryKey: keys.environments() })
    },
    onError: (error) =>
      toast.push({
        tone: 'danger',
        title: t('openAccess'),
        description:
          error instanceof ApiError ? [error.message, error.hint].filter(Boolean).join(' · ') : String(error),
      }),
  })
  const closeBridge = useMutation({
    mutationFn: (id: string) => api.closeBridge(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.access() })
      void queryClient.invalidateQueries({ queryKey: keys.environments() })
    },
  })

  const hostPort = (url: string) => {
    const match = /^(?:[a-z]+:\/\/)?([^/:]+):(\d+)/.exec(url)
    return match ? { host: match[1]!, port: match[2]! } : null
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size={size} variant={variant} aria-label={t('openTest')}>
            <ExternalLink />
            {t('openTest')}
            <ChevronDown className="opacity-60" />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {groups.length === 0 && !access.bridge ? (
            <MenuItem disabled>{access.kind === 'tcp' ? t('nothing') : t('nothing')}</MenuItem>
          ) : null}
          {groups.map((group) => (
            <div key={group.scope}>
              <ScopeLabel>{tc(`scope.${group.scope}`)}</ScopeLabel>
              {group.endpoints.map((endpoint) => (
                <div key={`${endpoint.provider}:${endpoint.url}`}>
                  {access.kind === 'http' ? (
                    <MenuItem disabled={!endpoint.usable} onSelect={() => open(endpoint.url)}>
                      <ExternalLink className="size-3.5" />
                      <Mono kind="url" tone="ink">
                        {endpoint.url}
                      </Mono>
                    </MenuItem>
                  ) : (
                    <MenuItem disabled={!endpoint.usable} onSelect={() => copy(endpoint.url)}>
                      <Copy className="size-3.5" />
                      <Mono kind="url" tone="ink">
                        {endpoint.url}
                      </Mono>
                    </MenuItem>
                  )}
                  {!endpoint.usable && endpoint.problem ? (
                    <div className="px-2 pb-1 text-2xs text-subtle">{endpoint.problem}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          {access.kind === 'tcp' ? (
            <>
              <MenuSeparator />
              {access.bridge ? (
                <>
                  <ScopeLabel>{t('bridge')}</ScopeLabel>
                  <MenuItem onSelect={() => copy(access.bridge!.bindIp)}>
                    <Copy className="size-3.5" /> {t('copyHost')} <Mono kind="host">{access.bridge.bindIp}</Mono>
                  </MenuItem>
                  {access.bridge.localPort !== null ? (
                    <MenuItem onSelect={() => copy(String(access.bridge!.localPort))}>
                      <Copy className="size-3.5" /> {t('copyPort')} <Mono kind="host">{access.bridge.localPort}</Mono>
                    </MenuItem>
                  ) : null}
                  <MenuItem onSelect={() => copy(access.bridge!.connectionString)}>
                    <Copy className="size-3.5" /> {t('copyConnectionString')}
                  </MenuItem>
                  <MenuItem onSelect={() => closeBridge.mutate(access.bridge!.id)}>
                    <PlugZap className="size-3.5" /> {t('closeAccess')}
                  </MenuItem>
                </>
              ) : (
                <MenuItem disabled={!service.actions.openAccess || bridge.isPending} onSelect={() => bridge.mutate()}>
                  <PlugZap className="size-3.5" /> {t('openAccess')}
                </MenuItem>
              )}
              {access.primary && hostPort(access.primary.url) ? (
                <>
                  <MenuItem onSelect={() => copy(hostPort(access.primary!.url)!.host)}>
                    <Copy className="size-3.5" /> {t('copyHost')}
                  </MenuItem>
                  <MenuItem onSelect={() => copy(hostPort(access.primary!.url)!.port)}>
                    <Copy className="size-3.5" /> {t('copyPort')}
                  </MenuItem>
                </>
              ) : null}
              <MenuItem onSelect={() => setConnection(true)}>{t('connection')}</MenuItem>
              <MenuItem onSelect={() => navigate('/access')}>{t('accessPage')}</MenuItem>
            </>
          ) : null}
          {onLogs ? (
            <>
              <MenuSeparator />
              <MenuItem onSelect={onLogs}>
                <ScrollText className="size-3.5" /> {t('logs')}
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>
      {connection ? <ConnectionDialog service={service} onClose={() => setConnection(false)} /> : null}
    </>
  )
}

function ConnectionDialog({ service, onClose }: { service: Service; onClose: () => void }) {
  const { t } = useTranslation('services', { keyPrefix: 'connection' })
  const query = useServiceConnection(service.environment, service.name, true)
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={t('title', { name: service.name })}
    >
      {query.isPending ? <Loading /> : null}
      {query.error ? <div className="text-xs text-danger">{query.error.message}</div> : null}
      {query.data ? <ConnectionDetails data={query.data} /> : null}
    </Dialog>
  )
}

/** The same menu for a whole environment: every routed address, by scope, and its logs. */
export function EnvironmentOpenMenu({ environment, size = 'sm' }: { environment: Environment; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('services', { keyPrefix: 'menu' })
  const { t: tc } = useTranslation('common')
  const { copy } = useCopy()
  const urls = orderEndpoints(environment.urls)
  const scopes = [...new Set(urls.map((url) => url.scope))]
  const tcp = environment.services.some((service) => service.kind !== 'http' && service.exposedPorts.length > 0)
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size={size} aria-label={t('openTest')}>
          <ExternalLink />
          {t('openTest')}
          <ChevronDown className="opacity-60" />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {urls.length === 0 ? <MenuItem disabled>{t('nothing')}</MenuItem> : null}
        {scopes.map((scope) => (
          <div key={scope}>
            <ScopeLabel>{tc(`scope.${scope}`)}</ScopeLabel>
            {urls
              .filter((url) => url.scope === scope)
              .map((url) => (
                <MenuItem key={url.url} onSelect={() => open(url.url)}>
                  <ExternalLink className="size-3.5" />
                  <Mono kind="url" tone="ink">
                    {url.url}
                  </Mono>
                </MenuItem>
              ))}
          </div>
        ))}
        {urls.length > 0 ? (
          <MenuItem onSelect={() => copy(urls.map((url) => url.url).join('\n'))}>
            <Copy className="size-3.5" /> {t('copy')}
          </MenuItem>
        ) : null}
        {tcp ? (
          <MenuItem onSelect={() => navigate('/access')}>
            <PlugZap className="size-3.5" /> {t('accessPage')}
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem onSelect={() => navigate(`/environments/${encodeURIComponent(environment.name)}/logs`)}>
          <ScrollText className="size-3.5" /> {t('logs')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
