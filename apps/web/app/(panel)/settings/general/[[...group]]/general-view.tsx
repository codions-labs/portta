'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ConfigField } from 'portta-contracts'
import { exampleHostnames, resolveDomain, slug } from 'portta-core/browser'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DashboardCard } from '@/components/dashboard-card'
import { ProjectDomainCard } from '@/components/domain-card'
import { AgentPermissionsCard } from '@/components/settings/agent-permissions-card'
import { PanelSettings } from '@/components/settings/panel-settings'
import { ProjectAccessSettings } from '@/components/settings/project-access-settings'
import { RestartSummary } from '@/components/settings/restart-summary'
import { SettingsGroup } from '@/components/settings/settings-group'
import { SettingsNav } from '@/components/settings/settings-nav'
import { displayValue, fieldByKey, valuesOf } from '@/components/settings/values'
import { isFieldVisible } from '@/components/settings/visibility'
import { Callout, Empty, ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useConfig } from '@/lib/queries'

/** GitHub is a group of the same file, shown in its own section. */
const ELSEWHERE = new Set(['GitHub'])
export function GeneralView({ group }: { group: string | null }) {
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
  const groups = useMemo(() => (view?.groups ?? []).filter((name) => !ELSEWHERE.has(name)), [view?.groups])
  const activeGroup = groups.find((name) => slug(name) === group) ?? (group === null ? groups[0] : undefined)

  useEffect(() => {
    const first = groups[0]
    if (group === null && first) router.replace(`/settings/general/${slug(first)}`)
  }, [group, groups, router])

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

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!view) return null

  const dirty = Object.keys(draft).length > 0
  const allFields = view.fields
  const currentValues = valuesOf(allFields, draft)
  const groupFields = activeGroup ? allFields.filter((field) => field.group === activeGroup) : []
  const visibleFields = groupFields.filter((field) => isFieldVisible(field.key, currentValues))
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

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          mayManage ? (
            <>
              {dirty ? <Badge tone="warn">{tc('unsaved', { count: Object.keys(draft).length })}</Badge> : null}
              <Button
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
                variant="primary"
                disabled={!dirty || save.isPending || !view.envFile.writable}
                onClick={requestSave}
              >
                <Save />
                {save.isPending ? tc('saving') : tc('save')}
              </Button>
            </>
          ) : null
        }
      />

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

      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        <SettingsNav groups={groups} active={activeGroup ?? null} dirtyCounts={dirtyCounts} />
        {activeGroup ? (
          <div className="min-w-0 flex-1 space-y-4">
            {activeGroup === 'Panel' ? (
              <PanelSettings
                fields={groupFields}
                values={currentValues}
                domain={liveDomain}
                valueFor={valueFor}
                onChange={setValue}
                onPatch={patchValues}
              />
            ) : activeGroup === 'Project access' ? (
              <ProjectAccessSettings
                fields={groupFields}
                values={currentValues}
                domain={liveDomain}
                valueFor={valueFor}
                onChange={setValue}
                onPatch={patchValues}
              />
            ) : (
              <SettingsGroup name={activeGroup} fields={visibleFields} valueFor={valueFor} onChange={setValue} />
            )}
            {activeGroup === 'Project domain' ? <ProjectDomainCard domain={liveDomain} /> : null}
            {activeGroup === 'Traefik' ? <DashboardCard /> : null}
            {activeGroup === 'Panel' ? <AgentPermissionsCard editable={mayManage} /> : null}
          </div>
        ) : (
          <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface">
            <Empty title={t('sectionNotFound', { group: group ?? '' })} hint={t('chooseGroup')} />
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-subtle">{t('secretsNote', { path: view.envFile.path })}</p>

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
