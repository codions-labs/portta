'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { ConfigField } from 'portta-contracts'
import { exampleHostnames, resolveDomain } from 'portta-core/browser'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Mono } from '@/components/copy'
import { DashboardCard } from '@/components/dashboard-card'
import { PanelSettings } from '@/components/settings/panel-settings'
import { ProjectAccessSettings } from '@/components/settings/project-access-settings'
import { ProjectDomainSettings } from '@/components/settings/project-domain-settings'
import { RestartSummary } from '@/components/settings/restart-summary'
import { hostGroupItems } from '@/components/settings/sections'
import { SettingsGroup } from '@/components/settings/settings-group'
import { useReportDirty } from '@/components/settings/settings-shell'
import { displayValue, fieldByKey, valuesOf } from '@/components/settings/values'
import { isFieldVisible } from '@/components/settings/visibility'
import { Callout, Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useConfig } from '@/lib/queries'

export function GeneralView({ group, field: focused = null }: { group: string | null; field?: string | null }) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const router = useRouter()
  const mayManage = useCan('settings:manage')
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [confirmPublic, setConfirmPublic] = useState(false)
  const query = useConfig()

  const view = query.data
  const groups = view?.groups ?? []
  const items = useMemo(() => hostGroupItems(groups), [groups])
  // `dns` and `tls` are one subject, and either address opens it.
  const active = group === null ? items[0] : items.find((item) => item.slugs.includes(group))
  const apply = useQuery({ queryKey: keys.apply(), queryFn: () => api.applyStatus(), enabled: mayManage })

  useEffect(() => {
    const first = items[0]
    if (group === null && first && groups.length > 0) router.replace(first.href)
  }, [group, groups, items, router])

  // Arriving from the search: put the setting in front of whoever asked for it.
  useEffect(() => {
    if (!focused || !view) return
    const target = document.getElementById(focused)
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  }, [focused, view])

  const save = useMutation({
    mutationFn: () => api.patchConfig(draft),
    onSuccess: () => {
      setDraft({})
      setError(null)
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: keys.config() })
      void queryClient.invalidateQueries({ queryKey: keys.apply() })
    },
    onError: (cause) => {
      setSaved(false)
      setError(cause)
    },
  })

  const dirtyCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!view) return counts
    const fieldGroups = new Map(view.fields.map((field) => [field.key, field.group]))
    for (const key of Object.keys(draft)) {
      const fieldGroup = fieldGroups.get(key)
      if (fieldGroup) counts.set(fieldGroup, (counts.get(fieldGroup) ?? 0) + 1)
    }
    return counts
  }, [draft, view])
  useReportDirty(dirtyCounts)

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!view) return null

  const dirty = Object.keys(draft).length > 0
  const allFields = view.fields
  const currentValues = valuesOf(allFields, draft)
  const fieldsOf = (name: string) => allFields.filter((field) => field.group === name)
  const groupFields = active ? active.groups.flatMap(fieldsOf) : []
  const pendingCount = allFields.filter((field) => field.pending).length
  const liveDomain = (() => {
    const resolved = resolveDomain({
      mode: currentValues.PORTTA_DOMAIN_MODE || view.projectDomain.mode,
      publicIp: currentValues.PORTTA_PUBLIC_IP || null,
      provider: currentValues.PORTTA_AUTO_DOMAIN_PROVIDER || view.projectDomain.provider,
      configured: currentValues.PORTTA_DOMAIN,
    })
    return {
      ...view.projectDomain,
      mode: resolved.mode,
      domain: resolved.domain,
      publicIp: currentValues.PORTTA_PUBLIC_IP || null,
      provider: currentValues.PORTTA_AUTO_DOMAIN_PROVIDER || view.projectDomain.provider,
      examples: exampleHostnames(resolved.domain),
      problem: resolved.problem,
    }
  })()

  const valueFor = (field: ConfigField): string => displayValue(field, draft)

  const setValue = (key: string, value: string | null) => {
    setSaved(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const patchValues = (updates: Record<string, string>) => {
    setSaved(false)
    setDraft((current) => ({ ...current, ...updates }))
  }

  const savedPublicField = fieldByKey(allFields, 'PUBLIC_ENABLED')
  const isEnablingPublic =
    draft.PUBLIC_ENABLED === 'true' && Boolean(savedPublicField) && displayValue(savedPublicField!, {}) !== 'true'

  const requestSave = () => {
    if (isEnablingPublic) setConfirmPublic(true)
    else save.mutate()
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-3">
      <span className="min-w-0 text-xs text-subtle">
        {t('savedIn')} <Mono kind="path">{view.envFile.path}</Mono>, {t('savedInSecrets')}
      </span>
      {mayManage ? (
        <span className="flex flex-wrap items-center gap-2">
          {dirty ? <Badge tone="warn">{tc('unsaved', { count: Object.keys(draft).length })}</Badge> : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft({})
              setSaved(false)
            }}
          >
            {tc('discard')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || save.isPending || !view.envFile.writable}
            onClick={requestSave}
          >
            {save.isPending ? tc('saving') : tc('save')}
          </Button>
        </span>
      ) : null}
    </div>
  )

  return (
    <>
      {!view.envFile.writable ? (
        <Callout tone="warn" className="mb-4">
          {t('notWritable', { path: view.envFile.path })}
        </Callout>
      ) : null}

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      {saved && !dirty ? (
        <Callout tone="ok" role="status" className="mb-4">
          {t('savedShort')}
        </Callout>
      ) : null}

      <RestartSummary fields={allFields} draft={draft} />

      {active ? (
        <div className="space-y-4">
          {active.groups.includes('Panel') ? (
            <>
              <PanelSettings
                fields={groupFields}
                values={currentValues}
                domain={liveDomain}
                valueFor={valueFor}
                onChange={setValue}
                onPatch={patchValues}
              />
              <Card>{footer}</Card>
            </>
          ) : active.groups.includes('Project access') ? (
            <>
              <ProjectAccessSettings
                fields={groupFields}
                values={currentValues}
                domain={liveDomain}
                valueFor={valueFor}
                onChange={setValue}
                onPatch={patchValues}
              />
              <Card>{footer}</Card>
            </>
          ) : active.groups.includes('Project domain') ? (
            <ProjectDomainSettings
              fields={groupFields}
              values={currentValues}
              domain={liveDomain}
              valueFor={valueFor}
              onChange={setValue}
              disabled={!mayManage}
              footer={footer}
            />
          ) : (
            active.groups.map((name, index) => (
              <SettingsGroup
                key={name}
                name={name}
                fields={fieldsOf(name).filter((field) => isFieldVisible(field.key, currentValues))}
                valueFor={valueFor}
                onChange={setValue}
                footer={index === active.groups.length - 1 ? footer : undefined}
              />
            ))
          )}
          {active.groups.includes('Traefik') ? <DashboardCard /> : null}
          {/* With an applier the bar at the top of the shell has the button. */}
          {mayManage && pendingCount > 0 && apply.data && !apply.data.available && !dirty ? (
            <Callout tone="warn" title={t('pendingApply.title', { count: pendingCount })}>
              {t('pendingApply.body')}
              <span className="mt-2 flex items-center gap-1 rounded-md bg-terminal py-1 pr-1 pl-3 text-terminal-fg">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{view.applyCommand}</span>
                <CopyButton
                  value={view.applyCommand}
                  label={tc('copyCommand')}
                  className="text-terminal-dim hover:text-terminal-fg"
                />
              </span>
            </Callout>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <Empty title={t('sectionNotFound', { group: group ?? '' })} hint={t('chooseGroup')} />
        </div>
      )}

      <Dialog
        open={confirmPublic}
        onOpenChange={setConfirmPublic}
        title={t('projectAccess.confirmTitle')}
        description={t('projectAccess.confirmDescription')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmPublic(false)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmPublic(false)
                save.mutate()
              }}
            >
              {t('projectAccess.confirm')}
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-subtle">{t('projectAccess.publicDomain')}</dt>
          <dd className="font-mono text-ink">{currentValues.PUBLIC_DOMAIN || liveDomain.domain}</dd>
          <dt className="text-subtle">{t('projectAccess.bind')}</dt>
          <dd className="font-mono text-ink">0.0.0.0</dd>
          <dt className="text-subtle">{t('projectAccess.ports')}</dt>
          <dd className="font-mono text-ink">
            {currentValues.PORTTA_HTTP_PORT || '80'} / {currentValues.PORTTA_HTTPS_PORT || '443'}
          </dd>
          <dt className="text-subtle">TLS</dt>
          <dd className="text-ink">{currentValues.TLS_ENABLED === 'true' ? tc('enabled') : tc('disabled')}</dd>
        </dl>
        <Callout tone="warn" className="mt-3">
          {t('projectAccess.confirmWarning')}
        </Callout>
      </Dialog>
    </>
  )
}
