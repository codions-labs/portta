'use client'

// Whether search engines and AI crawlers may read this project's addresses.
//
// Follows the server default, which keeps every crawler out, unless this project says otherwise.
// Letting one in is the choice that cannot be taken back, so it asks before it saves.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import type { CrawlerPolicy, Project } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { BLOCK_ALL, type CrawlerKind, CrawlerKindRows, presetOf } from '@/components/settings/crawler-kinds'
import { OptionCard } from '@/components/settings/option-card'
import { Callout, ErrorBox } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/field'
import { api } from '@/lib/api'
import { keys, useExposure, useProjectCrawlers } from '@/lib/queries'

type Choice = 'default' | 'block' | 'custom'

const anyAllowed = (policy: CrawlerPolicy) => Object.values(policy).some(Boolean)

export function ProjectCrawlers({ project, mayEdit }: { project: Project; mayEdit: boolean }) {
  const { t } = useTranslation('settings', { keyPrefix: 'crawlers' })
  const queryClient = useQueryClient()
  const query = useProjectCrawlers(project.slug)
  const exposure = useExposure()
  const [choice, setChoice] = useState<Choice | null>(null)
  const [custom, setCustom] = useState<CrawlerPolicy | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const save = useMutation({
    mutationFn: (policy: CrawlerPolicy | null) => api.setProjectCrawlers(project.slug, policy),
    onSuccess: () => {
      setChoice(null)
      setCustom(null)
      setConfirmed(false)
      void queryClient.invalidateQueries({ queryKey: keys.crawlers() })
      void queryClient.invalidateQueries({ queryKey: keys.projectCrawlers(project.slug) })
    },
  })

  if (!query.data) return query.isError ? <ErrorBox error={query.error} /> : null

  const state = query.data
  const savedChoice: Choice = state.own === null ? 'default' : presetOf(state.own) === 'all' ? 'block' : 'custom'
  const current = choice ?? savedChoice
  const policy: CrawlerPolicy =
    current === 'default' ? state.default : current === 'block' ? BLOCK_ALL : (custom ?? state.own ?? BLOCK_ALL)
  const dirty = choice !== null || custom !== null
  const needsConfirmation = current === 'custom' && anyAllowed(policy)
  const names = new Set(project.environments.map((entry) => entry.environment))
  const rows = (exposure.data?.entries ?? []).filter((entry) => entry.project !== null && names.has(entry.project))

  const pick = (value: Choice) => {
    setChoice(value)
    setConfirmed(false)
  }

  return (
    <Card>
      <CardHeader
        title={t('projectTitle')}
        description={t('projectDescription', { project: project.name })}
        meta={
          <Badge tone={state.mixed ? 'warn' : anyAllowed(state.effective) ? 'warn' : 'ok'}>
            {state.mixed ? t('state.mixed') : anyAllowed(state.effective) ? t('state.exception') : t('state.all')}
          </Badge>
        }
      />
      <CardBody className="space-y-2.5">
        {state.mixed ? <Callout tone="warn">{t('mixed')}</Callout> : null}
        <fieldset className="grid gap-2.5">
          <legend className="sr-only">{t('projectTitle')}</legend>
          <OptionCard
            name={`crawlers-${project.slug}`}
            checked={current === 'default'}
            disabled={!mayEdit || save.isPending}
            onSelect={() => pick('default')}
            title={t('choices.default.title')}
            help={t('choices.default.help')}
          />
          <OptionCard
            name={`crawlers-${project.slug}`}
            checked={current === 'block'}
            disabled={!mayEdit || save.isPending}
            onSelect={() => pick('block')}
            title={t('choices.block.title')}
            help={t('choices.block.help')}
          />
          <OptionCard
            name={`crawlers-${project.slug}`}
            checked={current === 'custom'}
            disabled={!mayEdit || save.isPending}
            onSelect={() => pick('custom')}
            title={t('choices.custom.title')}
            help={t('choices.custom.help')}
          />
        </fieldset>
        {current === 'custom' ? (
          <>
            <CrawlerKindRows
              policy={policy}
              disabled={!mayEdit || save.isPending}
              onChange={(kind: CrawlerKind, allowed) => {
                setCustom({ ...policy, [kind]: allowed })
                setConfirmed(false)
              }}
            />
            <Callout tone="warn">{t('irreversible')}</Callout>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={confirmed}
                disabled={!needsConfirmation}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                className="mt-0.5"
              />
              {t('confirm')}
            </label>
          </>
        ) : null}
        {save.isError ? <ErrorBox error={save.error} /> : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr>
                  <th className="px-3.5 py-2 font-medium">{t('table.address')}</th>
                  <th className="px-3.5 py-2 font-medium">{t('table.access')}</th>
                  <th className="px-3.5 py-2 font-medium">{t('table.search')}</th>
                  <th className="px-3.5 py-2 font-medium">{t('table.ai')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((entry) => {
                  const open = entry.mode === 'public'
                  // What the address's own environment follows: a project whose environments
                  // disagree shows each one's verdict, and a change not saved yet shows the draft.
                  const own = dirty ? policy : (state.byEnvironment[entry.project ?? ''] ?? policy)
                  const search = open && own.search
                  const ai = open && (own.train || own.live)
                  return (
                    <tr key={entry.host}>
                      <td className="px-3.5 py-2">
                        <Mono kind="text" tone="ink">
                          {entry.host}
                        </Mono>
                      </td>
                      <td className="px-3.5 py-2">
                        <Badge tone={open ? 'info' : 'ok'}>{open ? t('table.everyone') : t('table.password')}</Badge>
                      </td>
                      <td className="px-3.5 py-2">
                        <Badge tone={search ? 'warn' : 'ok'}>{search ? t('allowed') : t('blocked')}</Badge>
                      </td>
                      <td className="px-3.5 py-2">
                        <Badge tone={ai ? 'warn' : 'ok'}>{ai ? t('allowed') : t('blocked')}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="text-xs text-subtle">
          {t('serverDefault')}{' '}
          <Link href="/settings/crawlers" className="underline focus-ring">
            {t('changeDefault')}
          </Link>
        </p>
      </CardBody>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setChoice(null)
            setCustom(null)
            setConfirmed(false)
          }}
        >
          {t('discard')}
        </Button>
        <Button
          size="sm"
          disabled={!mayEdit || !dirty || save.isPending || (needsConfirmation && !confirmed)}
          onClick={() => save.mutate(current === 'default' ? null : policy)}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  )
}
