'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ContainerSummary } from 'portta-contracts'
import { hostnameFor, httpPortHint } from 'portta-core/browser'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { useCan } from '../lib/permissions.ts'
import { useGateway } from '../lib/queries/index.ts'
import { containerPortsFor } from '../lib/services.ts'
import { CopyButton, Mono } from './copy.tsx'
import { Callout, ErrorBox } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Checkbox, Input, Select } from './ui/field.tsx'

type Dns = { type: 'A' | 'CNAME'; name: string; value: string | null }
type Address = { alias: string; port: number }
type PendingAddress = Address & { requestId: string }

/** Every additional address of the service, whichever version of the setting stored it. */
export function additionalHosts(service: ContainerSummary): string[] {
  const stored = service.overrides?.aliases
  if (stored && stored.length > 0) return stored
  return service.overrides?.alias ? [service.overrides.alias] : []
}

export function ServiceAlias({
  project,
  service,
  onIntegrate,
}: {
  project: string
  service: ContainerSummary
  onIntegrate?: () => void
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'alias' })
  const { t: tw } = useTranslation('services', { keyPrefix: 'webAddress' })
  const name = service.service ?? service.name
  const secondary = service.kind !== 'http'
  const mayEdit = useCan('environment:settings')
  const mayOperate = useCan('environment:operate')
  const mayProtect = useCan('service:protect')
  const gateway = useGateway(mayEdit)
  const queryClient = useQueryClient()
  const labelPort = Number(
    Object.entries(service.labels).find(
      ([key]) => key.startsWith('traefik.http.services.') && key.endsWith('.loadbalancer.server.port'),
    )?.[1],
  )
  const ports = containerPortsFor(service).filter(
    ({ port, protocol }) => protocol === 'tcp' && httpPortHint(service.image, port) !== 'tcp',
  )
  if (
    Number.isInteger(labelPort) &&
    labelPort > 0 &&
    !ports.some(({ port }) => port === labelPort) &&
    httpPortHint(service.image, labelPort) !== 'tcp'
  ) {
    ports.push({ port: labelPort, protocol: 'tcp' })
  }
  const defaultPort =
    service.urls.find((url) => url.targetPort)?.targetPort ??
    (Number.isInteger(labelPort) && labelPort > 0 ? labelPort : undefined) ??
    ports.find(({ port }) => httpPortHint(service.image, port) === 'http')?.port ??
    ports[0]?.port
  const [chosenPort, setChosenPort] = useState<number | null>(null)
  const port = chosenPort ?? defaultPort
  const [value, setValue] = useState<string | null>(secondary ? null : '')
  const [confirmedHttp, setConfirmedHttp] = useState(false)
  const [dns, setDns] = useState<Dns | null>(null)
  const [password, setPassword] = useState<{ user: string | null; password: string } | null>(null)
  const [pending, setPending] = useState<PendingAddress | null>(null)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const needsIntegration = secondary && !service.onGatewayNetwork
  const explicitPort = secondary || ports.length > 1
  const unknownHttp =
    explicitPort &&
    port !== undefined &&
    httpPortHint(service.image, port) === 'unknown' &&
    labelPort !== port &&
    !service.urls.some((url) => url.targetPort === port)
  const protect = explicitPort && gateway.data?.profile === 'remote-public'
  const canCreate =
    service.state === 'running' &&
    mayEdit &&
    gateway.data?.panel.readOnly === false &&
    (!needsIntegration || mayOperate) &&
    (!protect || mayProtect)
  const canonicalHost = hostnameFor({ project, service: name }, gateway.data?.domain ?? 'localhost')
  const portSuffix = service.urls.some((url) => url.host === canonicalHost && (url.targetPort ?? labelPort) !== port)
  const suggestedHost = portSuffix
    ? hostnameFor({ project, service: `${name}-${port}` }, gateway.data?.domain ?? 'localhost')
    : canonicalHost
  const alias = value ?? suggestedHost
  const hosts = additionalHosts(service)
  const custom = new Set(service.urls.filter((url) => url.custom).map((url) => url.host))
  const derived = service.urls.filter((url) => !url.alias)

  const save = useMutation({
    mutationFn: (address: Address) =>
      explicitPort
        ? api.serviceAlias(project, name, address.alias, { port: address.port, ...(protect ? { protect: true } : {}) })
        : api.serviceAlias(project, name, address.alias),
    onSuccess: (result) => {
      setValue('')
      setDns(result.dns)
      setPassword(result.password ? { user: result.user ?? null, password: result.password } : null)
      void queryClient.invalidateQueries()
    },
  })
  const integration = useMutation({
    mutationFn: (address: Address) => api.serviceHttpIntegration(project, name, address),
    onSuccess: (result, address) => {
      if (result.ready) save.mutate(address)
      else if (result.requestId) setPending({ ...address, requestId: result.requestId })
      else setIntegrationError(tw('failed'))
    },
  })
  const status = useQuery({
    queryKey: ['service-http-integration', project, name, pending?.requestId],
    queryFn: () => api.serviceHttpIntegrationStatus(project, name, pending!.requestId),
    enabled: pending !== null,
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state === 'ok' || state === 'failed' || query.state.error ? false : 1000
    },
  })
  useEffect(() => {
    if (pending && status.error) {
      setPending(null)
      setIntegrationError(status.error.message)
      return
    }
    if (!pending || status.data?.requestId !== pending.requestId) return
    if (status.data.state === 'ok') {
      setPending(null)
      save.mutate(pending)
    } else if (status.data.state === 'failed') {
      setPending(null)
      setIntegrationError(status.data.error ?? tw('failed'))
    }
  }, [pending, status.data, status.error, save.mutate, tw])

  const clear = useMutation({
    mutationFn: (host: string) => api.clearServiceAlias(project, name, host),
    onSuccess: () => {
      setDns(null)
      void queryClient.invalidateQueries()
    },
  })
  const busy = save.isPending || integration.isPending || pending !== null
  const creating = hosts.length === 0 && secondary
  const failure = integrationError ?? status.error

  return (
    <div className="space-y-2">
      {derived.length > 0 || hosts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {derived.map((url) => (
            <Badge key={url.host} tone="outline">
              {url.host}
            </Badge>
          ))}
          {hosts.map((host) => {
            const targetPort = service.urls.find((url) => url.host === host)?.targetPort
            return (
              <span key={host} className="inline-flex items-center gap-1">
                <Badge tone="accent">
                  {host}
                  {targetPort ? ` → ${targetPort}` : ''}
                  {custom.has(host) ? ` · ${t('custom')}` : ''}
                </Badge>
                {mayEdit && gateway.data?.panel.readOnly === false ? (
                  <Button
                    size="sm"
                    disabled={clear.isPending || busy}
                    aria-label={t('remove', { host })}
                    onClick={() => clear.mutate(host)}
                  >
                    ×
                  </Button>
                ) : null}
              </span>
            )
          })}
        </div>
      ) : null}

      {canCreate && port !== undefined ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!alias.trim() || busy || (unknownHttp && !confirmedHttp)) return
            const address = { alias: alias.trim(), port }
            setIntegrationError(null)
            if (needsIntegration) {
              onIntegrate?.()
              integration.mutate(address)
            } else save.mutate(address)
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {explicitPort ? (
              <Select
                size="sm"
                className="w-36"
                aria-label={tw('port')}
                value={port}
                disabled={busy}
                onChange={(event) => {
                  setChosenPort(Number(event.target.value))
                  setConfirmedHttp(false)
                }}
              >
                {ports.map((entry) => (
                  <option key={entry.port} value={entry.port}>
                    {entry.port}/tcp{httpPortHint(service.image, entry.port) === 'http' ? ' · HTTP' : ''}
                  </option>
                ))}
              </Select>
            ) : null}
            <Input
              value={alias}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t('placeholder')}
              size="sm"
              className="w-64"
              aria-label={t('aliasFor', { name })}
              disabled={busy}
            />
            <Button size="sm" type="submit" disabled={busy || alias.trim() === '' || (unknownHttp && !confirmedHttp)}>
              {creating ? tw('create') : t('add')}
            </Button>
          </div>
          {unknownHttp ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <Checkbox
                checked={confirmedHttp}
                disabled={busy}
                onChange={(event) => setConfirmedHttp(event.target.checked)}
              />
              {tw('confirmHttp', { port })}
            </label>
          ) : null}
          {needsIntegration ? <p className="text-2xs text-subtle">{tw('integrationHint', { name })}</p> : null}
          {protect ? <p className="text-2xs text-subtle">{tw('protectedHint')}</p> : null}
        </form>
      ) : null}
      {busy ? (
        <p role="status" className="text-xs text-subtle">
          {pending || integration.isPending ? tw('integrating') : tw('creating')}
        </p>
      ) : null}
      {dns ? (
        <div className="rounded-md border border-border p-2 text-2xs" role="status">
          <p className="font-medium">{t('dnsTitle')}</p>
          <p className="font-mono">
            {dns.value
              ? t('dnsRecord', { type: dns.type, name: dns.name, value: dns.value })
              : t('dnsUnknown', { name: dns.name })}
          </p>
          <p className="text-subtle">{t('dnsCertificate')}</p>
        </div>
      ) : null}
      {password ? (
        <Callout tone="warn" title={tw('passwordTitle')}>
          {password.user ? <p>{tw('user', { user: password.user })}</p> : null}
          <Mono kind="text" tone="ink">
            {password.password}
          </Mono>
          <CopyButton value={password.password} label={tw('copyPassword')} className="ml-1" />
          <p>{tw('passwordHint')}</p>
        </Callout>
      ) : null}
      {save.error ? <ErrorBox error={save.error} /> : null}
      {integration.error ? <ErrorBox error={integration.error} /> : null}
      {failure ? <ErrorBox error={failure instanceof Error ? failure : new Error(failure)} /> : null}
      {canCreate && port !== undefined ? <p className="text-2xs text-subtle">{t('hint')}</p> : null}
    </div>
  )
}
