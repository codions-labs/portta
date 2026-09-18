'use client'

import Link from 'next/link'
import type { ConfigField, ProjectDomain } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '../copy.tsx'
import { Callout } from '../shell-bits.tsx'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { Field, Input } from '../ui/field.tsx'
import {
  type PrivateAccessKind,
  type ProjectAccessKind,
  privateAccessKind,
  privateAccessUpdates,
  projectAccessKind,
  projectAccessUpdates,
} from './access.ts'
import { ConfigField as ConfigFieldControl } from './config-field.tsx'
import { GroupIntro, LearnMore } from './learn-more.tsx'
import { SettingsSection } from './settings-group.tsx'
import { fieldByKey } from './values.ts'

type PublicDomainKind = 'base' | 'custom'

export function ProjectAccessSettings({
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
  const kind = projectAccessKind(values)
  const privateKind = privateAccessKind(values)
  const baseCanBeRemote = Boolean(domain.domain && domain.domain !== 'localhost')
  const configuredPublicDomain = values.PUBLIC_DOMAIN || ''
  const publicDomainKind: PublicDomainKind =
    baseCanBeRemote && (!configuredPublicDomain || configuredPublicDomain === domain.domain) ? 'base' : 'custom'
  const effectivePublicDomain =
    publicDomainKind === 'base' ? (baseCanBeRemote ? domain.domain : '') : configuredPublicDomain
  const tls = values.TLS_ENABLED === 'true'
  const scheme = tls ? 'https' : 'http'
  const privateBindNeedsAttention = ['0.0.0.0', '127.0.0.1', 'localhost', '::1', ''].includes(
    values.PORTTA_BIND_ADDRESS || '',
  )

  const pick = (keys: readonly string[]) =>
    keys.map((key) => fieldByKey(fields, key)).filter((field): field is ConfigField => Boolean(field))

  const setKind = (next: ProjectAccessKind) => {
    onPatch(projectAccessUpdates(next, domain.domain, configuredPublicDomain))
  }

  const setPublicDomainKind = (next: PublicDomainKind) => {
    onChange('PUBLIC_DOMAIN', next === 'base' && baseCanBeRemote ? domain.domain : '')
  }

  const setPrivateKind = (next: PrivateAccessKind) => {
    onPatch(privateAccessUpdates(next, values.PORTTA_BIND_ADDRESS || ''))
  }

  const bind =
    kind === 'public'
      ? '0.0.0.0'
      : kind === 'private' && privateKind === 'interface'
        ? values.PORTTA_BIND_ADDRESS || '—'
        : '127.0.0.1'
  const resultDomain =
    kind === 'public'
      ? effectivePublicDomain
      : kind === 'private'
        ? values.PRIVATE_DOMAIN || domain.domain
        : domain.domain

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('projectAccess.title')} description={<GroupIntro name="Project access" />} />
        <CardBody className="space-y-4">
          <fieldset className="grid gap-2">
            <legend className="sr-only">{t('projectAccess.title')}</legend>
            {(['local', 'private', 'public'] as const).map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 text-sm hover:bg-fill"
              >
                <input
                  type="radio"
                  name="project-access"
                  className="mt-0.5"
                  checked={kind === option}
                  onChange={() => setKind(option)}
                />
                <span>
                  <span className="block font-medium text-ink">{t(`projectAccess.kinds.${option}`)}</span>
                  <span className="block text-xs text-subtle">{t(`projectAccess.kindHelp.${option}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {kind === 'private' ? (
            <div className="space-y-3 rounded-md border border-line-subtle p-3">
              <div className="border-b border-line-subtle px-3 py-2">
                <h3 className="text-xs font-medium text-ink">{t('projectAccess.vpn')}</h3>
                <p className="text-xs text-subtle">{t('projectAccess.vpnHelp')}</p>
              </div>
              <fieldset className="grid gap-2">
                <legend className="sr-only">{t('projectAccess.vpn')}</legend>
                {(['tailscale', 'interface'] as const).map((option) => (
                  <label key={option} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="private-access-kind"
                      className="mt-0.5"
                      checked={privateKind === option}
                      onChange={() => setPrivateKind(option)}
                    />
                    <span>
                      <span className="block font-medium text-ink">{t(`projectAccess.privateKinds.${option}`)}</span>
                      <span className="block text-xs text-subtle">{t(`projectAccess.privateKindHelp.${option}`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="divide-y divide-line-subtle">
                {pick(
                  privateKind === 'tailscale'
                    ? ['TAILSCALE_HOSTNAME', 'TS_AUTHKEY', 'PRIVATE_DOMAIN']
                    : ['PORTTA_BIND_ADDRESS', 'PRIVATE_DOMAIN'],
                ).map((field) => (
                  <div key={field.key} className="py-3">
                    <ConfigFieldControl
                      field={field}
                      value={valueFor(field)}
                      onChange={(value) => onChange(field.key, value)}
                    />
                  </div>
                ))}
              </div>
              {privateKind === 'interface' && privateBindNeedsAttention ? (
                <Callout tone="warn">{t('projectAccess.privateBindNeeded')}</Callout>
              ) : null}
              {resultDomain === 'localhost' ? (
                <Callout tone="warn">{t('projectAccess.privateDomainNeeded')}</Callout>
              ) : null}
            </div>
          ) : null}

          {kind === 'public' ? (
            <div className="space-y-3 rounded-md border border-line-subtle p-3">
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium text-muted">{t('projectAccess.publicDomain')}</legend>
                {(['base', 'custom'] as const).map((option) => (
                  <label key={option} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="public-domain-kind"
                      className="mt-0.5"
                      checked={publicDomainKind === option}
                      disabled={option === 'base' && !baseCanBeRemote}
                      onChange={() => setPublicDomainKind(option)}
                    />
                    <span>{t(`projectAccess.publicDomainKinds.${option}`, { domain: domain.domain })}</span>
                  </label>
                ))}
              </fieldset>
              {publicDomainKind === 'custom' ? (
                <Field
                  id="public-project-domain"
                  label={t('projectAccess.customDomain')}
                  hint={t('projectAccess.customDomainHelp')}
                >
                  <Input
                    id="public-project-domain"
                    size="sm"
                    mono
                    className="max-w-md"
                    placeholder="dev.example.com"
                    value={configuredPublicDomain}
                    onChange={(event) => onChange('PUBLIC_DOMAIN', event.target.value)}
                  />
                </Field>
              ) : null}
              {!effectivePublicDomain ? <Callout tone="warn">{t('projectAccess.needsDomain')}</Callout> : null}
              {!tls ? <Callout tone="warn">{t('projectAccess.noTls')}</Callout> : null}
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link className="rounded-xs text-accent hover:underline focus-ring" href="/settings/general/dns">
                  {t('configureDns')}
                </Link>
                <Link className="rounded-xs text-accent hover:underline focus-ring" href="/settings/general/tls">
                  {t('configureTls')}
                </Link>
                <LearnMore citation="docs/product/concepts/addresses-and-access.md#public-access" />
              </p>
            </div>
          ) : null}

          <div className="grid gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs sm:grid-cols-3">
            <span>
              {t('projectAccess.bind')}{' '}
              <Mono kind="host" tone="ink">
                {bind}
              </Mono>
            </span>
            <span>
              {t('projectAccess.ports')}{' '}
              <Mono tone="ink">
                {values.PORTTA_HTTP_PORT || '80'} / {values.PORTTA_HTTPS_PORT || '443'}
              </Mono>
            </span>
            <span>
              {t('projectAccess.result')}{' '}
              <Mono kind="host" tone="ink">
                {resultDomain ? `${scheme}://loja-web.${resultDomain}` : '—'}
              </Mono>
            </span>
          </div>
        </CardBody>
      </Card>

      <SettingsSection
        title={t('projectAccess.network')}
        description={t('projectAccess.networkHelp')}
        fields={pick(['PORTTA_HTTP_PORT', 'PORTTA_HTTPS_PORT', 'PORTTA_LOG_LEVEL', 'PORTTA_ACCESS_LOG'])}
        valueFor={valueFor}
        onChange={onChange}
      />
    </div>
  )
}
