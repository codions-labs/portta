'use client'

import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { ConfigField, ProjectDomain } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { CodeChip, Mono } from '../copy.tsx'
import { DocText } from '../doc-text.tsx'
import { Callout } from '../shell-bits.tsx'
import { Button } from '../ui/button.tsx'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { Field, Input } from '../ui/field.tsx'
import {
  type PanelAccessKind,
  type PanelHostnameKind,
  panelAccessKind,
  panelAccessUpdates,
  panelHostnameKind,
  panelPreviewUrl,
  panelSubdomain,
} from './access.ts'
import { GroupIntro, LearnMore } from './learn-more.tsx'
import { SettingsSection } from './settings-group.tsx'
import { fieldByKey } from './values.ts'
import { PANEL_SECTIONS } from './visibility.ts'

export function PanelSettings({
  fields,
  values,
  domain,
  valueFor,
  onChange,
  onPatch,
}: {
  fields: ConfigField[]
  values: Record<string, string>
  domain: ProjectDomain
  valueFor: (field: ConfigField) => string
  onChange: (key: string, value: string | null) => void
  onPatch: (updates: Record<string, string>) => void
}) {
  const { t } = useTranslation('settings')
  const expose = values.PORTTA_WEB_EXPOSE || 'local'
  const kind = panelAccessKind(expose)
  const advertised = values.PORTTA_PANEL_ADVERTISED_HOST || ''
  const subdomain = panelSubdomain(expose, advertised, values.PORTTA_WEB_HOST || 'portta-web', domain.domain)
  const publicAddress = advertised || domain.publicIp || ''
  const hostnameKind = panelHostnameKind(expose, advertised, subdomain, domain.domain)
  const tls = values.TLS_ENABLED === 'true'
  const preview = panelPreviewUrl({
    expose,
    port: values.PORTTA_WEB_PORT || '8081',
    bind: values.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1',
    subdomain,
    advertised,
    base: domain.domain,
    tls,
  })

  const pick = (keys: readonly string[]) =>
    keys.map((key) => fieldByKey(fields, key)).filter((field): field is ConfigField => Boolean(field))

  const setAccess = (next: PanelAccessKind, nextHostname: PanelHostnameKind = hostnameKind) => {
    onPatch(
      panelAccessUpdates({
        kind: next,
        hostnameKind: nextHostname,
        subdomain,
        advertisedHost: next === 'public' ? publicAddress : advertised && hostnameKind === 'custom' ? advertised : '',
        port: values.PORTTA_WEB_PORT || '8081',
        bind: values.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1',
        base: domain.domain,
        tls,
      }),
    )
  }

  const setSubdomain = (value: string) => {
    onPatch(
      panelAccessUpdates({
        kind: 'hostname',
        hostnameKind: 'subdomain',
        subdomain: value,
        advertisedHost: '',
        port: values.PORTTA_WEB_PORT || '8081',
        bind: values.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1',
        base: domain.domain,
        tls,
      }),
    )
  }

  const setCustomHost = (value: string) => {
    onPatch(
      panelAccessUpdates({
        kind: 'hostname',
        hostnameKind: 'custom',
        subdomain,
        advertisedHost: value,
        port: values.PORTTA_WEB_PORT || '8081',
        bind: values.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1',
        base: domain.domain,
        tls,
      }),
    )
  }

  const setPublicAddress = (value: string) => {
    onPatch(
      panelAccessUpdates({
        kind: 'public',
        hostnameKind,
        subdomain,
        advertisedHost: value,
        port: values.PORTTA_WEB_PORT || '8081',
        bind: values.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1',
        base: domain.domain,
        tls,
      }),
    )
  }

  const setNetworkValue = (key: string, value: string | null) => {
    const port = key === 'PORTTA_WEB_PORT' ? (value ?? '') : values.PORTTA_WEB_PORT || '8081'
    const bind = key === 'PORTTA_WEB_BIND_ADDRESS' ? (value ?? '') : values.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1'
    const nextUrl = panelPreviewUrl({
      expose,
      port,
      bind,
      subdomain,
      advertised,
      base: domain.domain,
      tls,
    })
    onPatch({
      [key]: value ?? '',
      PORTTA_PANEL_URL: nextUrl || `http://127.0.0.1:${port || '8081'}`,
    })
  }

  const beyondLocal = kind !== 'local'

  return (
    <div className="space-y-4">
      <SettingsSection
        title={t('panel.network')}
        description={t('panel.networkHelp')}
        fields={pick(PANEL_SECTIONS.network)}
        valueFor={valueFor}
        onChange={setNetworkValue}
        disabledKeys={kind === 'public' || kind === 'hostname' ? new Set(['PORTTA_WEB_BIND_ADDRESS']) : undefined}
      />

      <Card>
        <CardHeader title={t('panel.access')} description={<GroupIntro name="Panel" />} />
        <CardBody className="space-y-4">
          <fieldset className="grid gap-2">
            <legend className="sr-only">{t('panel.access')}</legend>
            {(['local', 'tailscale', 'public', 'hostname'] as const).map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 text-sm hover:bg-fill"
              >
                <input
                  type="radio"
                  name="panel-access"
                  className="mt-0.5"
                  checked={kind === option}
                  onChange={() => setAccess(option, option === 'hostname' ? 'subdomain' : hostnameKind)}
                />
                <span>
                  <span className="block font-medium text-ink">{t(`panel.kinds.${option}`)}</span>
                  <span className="block text-xs text-subtle">{t(`panel.kindHelp.${option}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {kind === 'public' ? (
            <div className="space-y-2 rounded-md border border-line-subtle p-3">
              <Field id="panel-public-address" label={t('panel.publicAddress')} hint={t('panel.publicAddressHelp')}>
                <Input
                  id="panel-public-address"
                  size="sm"
                  mono
                  className="max-w-md"
                  placeholder="203.0.113.10"
                  value={advertised}
                  onChange={(event) => setPublicAddress(event.target.value)}
                />
              </Field>
              {!advertised ? <Callout tone="warn">{t('panel.publicAddressNeeded')}</Callout> : null}
            </div>
          ) : null}

          {kind === 'hostname' ? (
            <div className="space-y-3 rounded-md border border-line-subtle p-3">
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium text-muted">{t('panel.addressMode')}</legend>
                {(['subdomain', 'custom'] as const).map((option) => (
                  <label key={option} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="panel-hostname"
                      className="mt-0.5"
                      checked={hostnameKind === option}
                      disabled={option === 'custom' && !tls}
                      onChange={() => setAccess('hostname', option)}
                    />
                    <span>{t(`panel.hostnameKinds.${option}`)}</span>
                  </label>
                ))}
              </fieldset>

              {hostnameKind === 'subdomain' ? (
                <Field id="panel-subdomain" label={t('panel.subdomain')} hint={t('panel.subdomainHelp')}>
                  <span className="flex max-w-md items-center gap-1.5">
                    <Input
                      id="panel-subdomain"
                      size="sm"
                      mono
                      className="max-w-[10rem]"
                      value={subdomain}
                      onChange={(event) => setSubdomain(event.target.value)}
                    />
                    <span className="text-sm text-subtle">.{domain.domain}</span>
                  </span>
                </Field>
              ) : (
                <Field
                  id="panel-custom-host"
                  label={t('panel.customDomain')}
                  hint={<DocText citationLabel={t('learnMore')}>{t('panel.customDomainHelp')}</DocText>}
                >
                  <Input
                    id="panel-custom-host"
                    size="sm"
                    mono
                    className="max-w-md"
                    placeholder="portta.example.com"
                    value={hostnameKind === 'custom' ? advertised : ''}
                    onChange={(event) => setCustomHost(event.target.value)}
                  />
                </Field>
              )}
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link className="rounded-xs text-accent hover:underline focus-ring" href="/settings/general/dns">
                  {t('configureDns')}
                </Link>
                <Link className="rounded-xs text-accent hover:underline focus-ring" href="/settings/general/tls">
                  {t('configureTls')}
                </Link>
                <LearnMore citation="docs/product/concepts/addresses-and-access.md#custom-panel-domain" />
              </p>
            </div>
          ) : null}

          {beyondLocal ? <Callout tone="warn">{t('panel.authRequired')}</Callout> : null}

          {kind === 'tailscale' &&
          ['127.0.0.1', 'localhost', '::1', ''].includes(values.PORTTA_WEB_BIND_ADDRESS || '') ? (
            <Callout tone="warn">{t('panel.tailnetBindNeeded')}</Callout>
          ) : null}

          {kind === 'hostname' && !tls && (hostnameKind === 'custom' || values.PORTTA_PROFILE === 'remote-public') ? (
            <Callout tone="warn">
              <DocText citationLabel={t('learnMore')}>{t('panel.tlsNeeded')}</DocText>
            </Callout>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-subtle">{t('panel.result')}</span>
            {preview ? (
              <Mono kind="url" tone="ink" className="text-xs">
                {preview}
              </Mono>
            ) : (
              <CodeChip tone="muted">—</CodeChip>
            )}
            {preview ? (
              <Button size="sm" variant="ghost" onClick={() => window.open(preview, '_blank', 'noreferrer')}>
                <ExternalLink />
                {t('panel.open')}
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <SettingsSection
        title={t('panel.security')}
        description={t('panel.securityHelp')}
        fields={pick(PANEL_SECTIONS.security)}
        valueFor={valueFor}
        onChange={onChange}
      />

      <SettingsSection
        title={t('panel.features')}
        description={t('panel.featuresHelp')}
        fields={pick(PANEL_SECTIONS.features)}
        valueFor={valueFor}
        onChange={onChange}
      />
    </div>
  )
}
